/**
 * Project Name: Developer Insights
 * Purpose: Generate comprehensive individual efficiency reports for performance reviews by analyzing GitHub developer activity
 * Description: A unified GitHub Developer Insights Platform that consolidates multiple analysis modules to provide detailed metrics on developer productivity, code quality, and work patterns
 *
 * Requirements Summary:
 * - Unified data fetching engine using GitHub GraphQL API with intelligent caching
 * - Modular analyzer design supporting PR throughput, code churn, work patterns, and cycle time analysis
 * - Multiple export formats: JSON, CSV, HTML, and database (SQLite3/Postgres)
 * - Comprehensive CLI interface with date range filtering and repository scoping
 * - Robust error handling, rate limiting, and progress tracking
 *
 * JSON Report Structure Example:
 * {
 *   "metadata": { "reportVersion": "1.0", "searchUser": "username", "dateRange": {...}, "repositoriesAnalyzed": [...] },
 *   "summary": { "totalContributions": 1250, "totalCommits": 150, "totalPRsCreated": 25, ... },
 *   "analytics": { "prThroughput": {...}, "codeChurn": {...}, "workPatterns": {...}, "prCycleTime": {...} },
 *   "rawData": { "pullRequests": [...], "commits": [...] }
 * }
 *
 * Potential Insights:
 * - Developer productivity trends and patterns
 * - Code quality metrics and complexity analysis
 * - Collaboration effectiveness and review participation
 * - Work-life balance indicators through commit timing analysis
 * - Performance bottlenecks in development processes
 */

import { Command } from "commander";
import { Octokit } from "octokit";
import { graphql } from "@octokit/graphql";
import {
  ProgressBar,
  CLIProgressHelper,
  Colors,
} from "@thinkeloquent/cli-progressor";
import { API_Rate_Limiter } from "@thinkeloquent/npm-api-rate-limiter";
import chalk from "chalk";
import { z } from "zod";
import { expect } from "expect";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { createWriteStream } from "fs";
import { Sequelize, DataTypes } from "sequelize";
import dotenv from "dotenv";

// Environment variables should be set at the top
process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN;
process.env.GITHUB_BASE_API_URL =
  process.env.GITHUB_BASE_API_URL || "https://api.github.com";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Zod Schemas for validation
const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");

const MetaTagSchema = z.record(z.string(), z.string());

const ConfigSchema = z.object({
  searchUser: z.string().min(1, "Search user is required"),
  org: z.string().optional(),
  repo: z.string().optional(),
  metaTags: MetaTagSchema.optional().default({}),
  format: z.enum(["json", "csv", "html", "database"]).default("json"),
  outputDir: z.string().default("./output"),
  filename: z.string().optional(),
  ignoreDateRange: z.boolean().default(false),
  start: DateSchema.optional(),
  end: DateSchema.optional(),
  token: z.string().min(1, "GitHub token is required"),
  verbose: z.boolean().default(false),
  debug: z.boolean().default(false),
  loadData: z.string().optional(),
  totalRecords: z.number().min(0).default(0),
  delay: z.number().min(0).default(6),
  partitionStrategy: z.enum(["time", "size", "auto"]).default("auto"),
  fetchStrategy: z
    .enum(["commits-by-date", "code-by-size", "repos-by-date"])
    .default("commits-by-date"),
  modules: z
    .string()
    .default("prThroughput,codeChurn,workPatterns,prCycleTime"),
  databaseUrl: z.string().optional(),
});

const GitHubUserSchema = z.object({
  login: z.string(),
  id: z.number(),
  type: z.string(),
});

const PullRequestSchema = z.object({
  id: z.number(),
  number: z.number(),
  title: z.string(),
  state: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  merged_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  additions: z.number(),
  deletions: z.number(),
  changed_files: z.number(),
  repository: z.object({
    full_name: z.string(),
    name: z.string(),
    owner: z.object({ login: z.string() }),
  }),
});

const CommitSchema = z.object({
  sha: z.string(),
  commit: z.object({
    author: z.object({
      name: z.string(),
      email: z.string(),
      date: z.string(),
    }),
    message: z.string(),
  }),
  stats: z
    .object({
      additions: z.number(),
      deletions: z.number(),
      total: z.number(),
    })
    .optional(),
});

// Core Data Engine for GitHub API interactions
class GitHubDataEngine {
  constructor(options) {
    // Fix: Spread options first to prevent overriding
    this.options = {
      ...options,
      token: options.token || process.env.GITHUB_TOKEN,
      verbose: options.verbose || false,
      debug: options.debug || false,
      delay: options.delay || 6,
    };

    if (!this.options.token) {
      throw new Error(
        "GitHub token is required. Please provide it via:\n" +
          "  1. --token flag: node main.mjs --token YOUR_TOKEN\n" +
          "  2. Environment variable: export GITHUB_TOKEN=YOUR_TOKEN\n" +
          "  3. .env file: GITHUB_TOKEN=YOUR_TOKEN"
      );
    }

    const baseUrl = process.env.GITHUB_BASE_API_URL || "https://api.github.com";
    this.octokit = new Octokit({
      auth: this.options.token,
      baseUrl: baseUrl,
    });

    this.graphqlWithAuth = graphql.defaults({
      headers: { authorization: `token ${this.options.token}` },
      baseUrl: baseUrl,
    });

    this.cache = new Map();
    this.apiCallCount = 0;
    this.apiPaths = new Set();
    this.auditLog = [];
    this.githubLogStream = null;
    this.totalRecordsFetched = 0;

    // Initialize rate limiters for different GitHub API endpoints
    this.coreLimiter = new API_Rate_Limiter("github-core", {
      getRateLimitStatus: () => this.getGitHubRateLimit("core"),
    });

    this.searchLimiter = new API_Rate_Limiter("github-search", {
      getRateLimitStatus: () => this.getGitHubRateLimit("search"),
    });

    if (this.options.verbose) {
      this.initializeGithubLog();
    }
  }

  async initializeGithubLog() {
    try {
      this.githubLogStream = createWriteStream("github.log", { flags: "a" });
    } catch (error) {
      console.warn(chalk.yellow("Warning: Could not create github.log file"));
    }
  }

  logToFile(message) {
    if (this.githubLogStream) {
      this.githubLogStream.write(`${new Date().toISOString()} - ${message}\n`);
    }
  }

  async getGitHubRateLimit(resource = "core") {
    try {
      const response = await this.octokit.request("GET /rate_limit");
      const data = response.data;
      return data.resources[resource];
    } catch (error) {
      console.warn(
        chalk.yellow("Could not fetch GitHub rate limit, using safe defaults."),
        error.message
      );
      // Return a very safe default if the check fails
      return { remaining: 1, reset: Math.floor(Date.now() / 1000) + 60 };
    }
  }

  async makeRequest(path, params = {}) {
    return this.coreLimiter.schedule(async () => {
      this.apiCallCount++;
      this.apiPaths.add(path);

      if (
        this.options.totalRecords > 0 &&
        this.totalRecordsFetched >= this.options.totalRecords
      ) {
        throw new Error(
          `Total records limit of ${this.options.totalRecords} exceeded`
        );
      }

      try {
        const result = await this.octokit.request(path, params);

        if (this.options.debug) {
          this.auditLog.push({
            timestamp: new Date().toISOString(),
            path,
            params,
            status: result.status,
            dataLength: JSON.stringify(result.data).length,
          });
        }

        if (this.options.verbose) {
          console.log(chalk.gray(`API: ${path}`));
          this.logToFile(`Request: ${path} - Status: ${result.status}`);
        }

        // Validate response data
        expect(result.data).toBeDefined();
        expect(result.status).toBeGreaterThanOrEqual(200);
        expect(result.status).toBeLessThan(300);

        return result.data;
      } catch (error) {
        if (this.options.debug) {
          this.auditLog.push({
            timestamp: new Date().toISOString(),
            path,
            params,
            error: error.message,
            status: error.status,
          });
        }
        throw error;
      }
    });
  }

  async makeSearchRequest(path, params = {}) {
    return this.searchLimiter.schedule(async () => {
      this.apiCallCount++;
      this.apiPaths.add(path);

      if (
        this.options.totalRecords > 0 &&
        this.totalRecordsFetched >= this.options.totalRecords
      ) {
        throw new Error(
          `Total records limit of ${this.options.totalRecords} exceeded`
        );
      }

      try {
        // Add delay for search requests
        await new Promise((resolve) =>
          setTimeout(resolve, this.options.delay * 1000)
        );

        const result = await this.octokit.request(path, params);

        if (this.options.debug) {
          this.auditLog.push({
            timestamp: new Date().toISOString(),
            path,
            params,
            status: result.status,
            dataLength: JSON.stringify(result.data).length,
          });
        }

        if (this.options.verbose) {
          console.log(chalk.gray(`Search API: ${path}`));
          this.logToFile(`Search Request: ${path} - Status: ${result.status}`);
        }

        // Validate response data
        expect(result.data).toBeDefined();
        expect(result.status).toBeGreaterThanOrEqual(200);
        expect(result.status).toBeLessThan(300);

        return result.data;
      } catch (error) {
        if (this.options.debug) {
          this.auditLog.push({
            timestamp: new Date().toISOString(),
            path,
            params,
            error: error.message,
            status: error.status,
          });
        }
        throw error;
      }
    });
  }

  async makeGraphQLRequest(query, variables = {}) {
    return this.coreLimiter.schedule(async () => {
      this.apiCallCount++;
      this.apiPaths.add("GraphQL Query");

      if (
        this.options.totalRecords > 0 &&
        this.totalRecordsFetched >= this.options.totalRecords
      ) {
        throw new Error(
          `Total records limit of ${this.options.totalRecords} exceeded`
        );
      }

      try {
        const result = await this.graphqlWithAuth(query, variables);

        if (this.options.debug) {
          this.auditLog.push({
            timestamp: new Date().toISOString(),
            type: "GraphQL",
            query: query.substring(0, 100),
            variables,
            dataLength: JSON.stringify(result).length,
          });
        }

        if (this.options.verbose) {
          this.logToFile(
            `GraphQL Query executed - Variables: ${JSON.stringify(variables)}`
          );
        }

        return result;
      } catch (error) {
        if (this.options.debug) {
          this.auditLog.push({
            timestamp: new Date().toISOString(),
            type: "GraphQL",
            query: query.substring(0, 100),
            variables,
            error: error.message,
          });
        }
        throw error;
      }
    });
  }

  getCacheKey(type, params) {
    return `${type}:${JSON.stringify(params)}`;
  }

  async validateUser(username) {
    const cacheKey = this.getCacheKey("user", { username });
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const user = await this.makeRequest("GET /users/{username}", {
        username,
      });
      const validatedUser = GitHubUserSchema.parse(user);
      this.cache.set(cacheKey, validatedUser);
      return validatedUser;
    } catch (error) {
      throw new Error(`Failed to validate user ${username}: ${error.message}`);
    }
  }

  async fetchPullRequests(
    searchUser,
    startDate,
    endDate,
    org = null,
    repos = null
  ) {
    const cacheKey = this.getCacheKey("pullRequests", {
      searchUser,
      startDate,
      endDate,
      org,
      repos,
    });
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const pullRequests = [];
    const perPage = 100;

    try {
      // Use issues.listForUser for better API compatibility
      const searchQueries = [];

      if (!this.options.ignoreDateRange && startDate && endDate) {
        // Time-based partitioning to handle >1000 results
        const timeRanges = this.generateTimeRanges(
          startDate,
          endDate,
          "weekly"
        );

        for (const range of timeRanges) {
          const authorQuery = `author:${searchUser} is:pull-request created:${range.start}..${range.end}`;
          const userQuery = `user:${searchUser} is:pull-request created:${range.start}..${range.end}`;

          if (org) {
            searchQueries.push(`${authorQuery} org:${org}`);
            searchQueries.push(`${userQuery} org:${org}`);
          } else if (repos) {
            const repoList = repos
              .split(",")
              .map((r) => `repo:${r.trim()}`)
              .join(" ");
            searchQueries.push(`${authorQuery} ${repoList}`);
            searchQueries.push(`${userQuery} ${repoList}`);
          } else {
            searchQueries.push(authorQuery);
            searchQueries.push(userQuery);
          }
        }
      } else {
        // No date range queries
        const authorQuery = `author:${searchUser} is:pull-request`;
        const userQuery = `user:${searchUser} is:pull-request`;

        if (org) {
          searchQueries.push(`${authorQuery} org:${org}`);
          searchQueries.push(`${userQuery} org:${org}`);
        } else if (repos) {
          const repoList = repos
            .split(",")
            .map((r) => `repo:${r.trim()}`)
            .join(" ");
          searchQueries.push(`${authorQuery} ${repoList}`);
          searchQueries.push(`${userQuery} ${repoList}`);
        } else {
          searchQueries.push(authorQuery);
          searchQueries.push(userQuery);
        }
      }

      // Execute all search queries with progress tracking
      for (const query of searchQueries) {
        let page = 1;

        while (true) {
          if (
            this.options.totalRecords > 0 &&
            this.totalRecordsFetched >= this.options.totalRecords
          ) {
            break;
          }

          const searchResult = await this.makeSearchRequest(
            "GET /search/issues",
            {
              q: query,
              page,
              per_page: Math.min(
                perPage,
                this.options.totalRecords > 0
                  ? this.options.totalRecords - this.totalRecordsFetched
                  : perPage
              ),
              sort: "created",
              order: "desc",
            }
          );

          if (!searchResult.items || searchResult.items.length === 0) break;

          this.totalRecordsFetched += searchResult.items.length;

          // Fetch detailed PR information
          for (const item of searchResult.items) {
            try {
              const [owner, repo] = item.repository_url.split("/").slice(-2);
              const prDetail = await this.makeRequest(
                "GET /repos/{owner}/{repo}/pulls/{pull_number}",
                {
                  owner,
                  repo,
                  pull_number: item.number,
                }
              );

              pullRequests.push({
                ...prDetail,
                repository: {
                  full_name: `${owner}/${repo}`,
                  name: repo,
                  owner: { login: owner },
                },
              });
            } catch (error) {
              console.warn(
                chalk.yellow(
                  `Warning: Failed to fetch PR details for #${item.number}: ${error.message}`
                )
              );
            }
          }

          if (searchResult.items.length < perPage) break;
          page++;
        }
      }

      // Remove duplicates based on PR ID
      const uniquePRs = Array.from(
        new Map(pullRequests.map((pr) => [pr.id, pr])).values()
      );

      this.cache.set(cacheKey, uniquePRs);
      return uniquePRs;
    } catch (error) {
      throw new Error(`Failed to fetch pull requests: ${error.message}`);
    }
  }

  generateTimeRanges(startDate, endDate, interval = "weekly") {
    const ranges = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    let current = new Date(start);

    while (current < end) {
      const rangeEnd = new Date(current);

      switch (interval) {
        case "daily":
          rangeEnd.setDate(rangeEnd.getDate() + 1);
          break;
        case "weekly":
          rangeEnd.setDate(rangeEnd.getDate() + 7);
          break;
        case "monthly":
          rangeEnd.setMonth(rangeEnd.getMonth() + 1);
          break;
      }

      if (rangeEnd > end) {
        rangeEnd.setTime(end.getTime());
      }

      ranges.push({
        start: current.toISOString().split("T")[0],
        end: rangeEnd.toISOString().split("T")[0],
      });

      current = new Date(rangeEnd);
      current.setDate(current.getDate() + 1);
    }

    return ranges;
  }

  async fetchCommits(searchUser, startDate, endDate, repos = []) {
    const cacheKey = this.getCacheKey("commits", {
      searchUser,
      startDate,
      endDate,
      repos,
    });
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const commits = [];

    // If specific repos provided, search within them
    if (repos && repos.length > 0) {
      for (const repoFullName of repos) {
        try {
          const [owner, repo] = repoFullName.split("/");
          let page = 1;
          const perPage = 100;

          while (true) {
            if (
              this.options.totalRecords > 0 &&
              this.totalRecordsFetched >= this.options.totalRecords
            ) {
              break;
            }

            const params = {
              owner,
              repo,
              author: searchUser,
              page,
              per_page: Math.min(
                perPage,
                this.options.totalRecords > 0
                  ? this.options.totalRecords - this.totalRecordsFetched
                  : perPage
              ),
            };

            if (!this.options.ignoreDateRange && startDate && endDate) {
              params.since = `${startDate}T00:00:00Z`;
              params.until = `${endDate}T23:59:59Z`;
            }

            const repoCommits = await this.makeRequest(
              "GET /repos/{owner}/{repo}/commits",
              params
            );

            if (!repoCommits || repoCommits.length === 0) break;

            this.totalRecordsFetched += repoCommits.length;

            // Fetch commit stats
            for (const commit of repoCommits) {
              try {
                const commitDetail = await this.makeRequest(
                  "GET /repos/{owner}/{repo}/commits/{ref}",
                  {
                    owner,
                    repo,
                    ref: commit.sha,
                  }
                );
                commits.push({
                  ...commitDetail,
                  repository: {
                    full_name: repoFullName,
                    name: repo,
                    owner: { login: owner },
                  },
                });
              } catch (error) {
                console.warn(
                  chalk.yellow(
                    `Warning: Failed to fetch commit stats for ${commit.sha}: ${error.message}`
                  )
                );
              }
            }

            if (repoCommits.length < perPage) break;
            page++;
          }
        } catch (error) {
          console.warn(
            chalk.yellow(
              `Warning: Failed to fetch commits from ${repoFullName}: ${error.message}`
            )
          );
        }
      }
    }

    this.cache.set(cacheKey, commits);
    return commits;
  }

  async discoverUserRepositories(searchUser, startDate, endDate) {
    // Use GraphQL to discover repositories where user has activity
    const query = `
      query($searchQuery: String!) {
        search(
          type: REPOSITORY
          query: $searchQuery
          first: 100
        ) {
          nodes {
            ... on Repository {
              nameWithOwner
              name
              owner {
                login
              }
            }
          }
        }
      }
    `;

    try {
      let searchQuery;
      if (!this.options.ignoreDateRange && startDate && endDate) {
        searchQuery = `pushed:${startDate}..${endDate} committer:${searchUser}`;
      } else {
        searchQuery = `committer:${searchUser}`;
      }

      const result = await this.makeGraphQLRequest(query, {
        searchQuery,
      });

      return result.search.nodes.map((repo) => repo.nameWithOwner);
    } catch (error) {
      console.warn(
        chalk.yellow(
          `Warning: Failed to discover repositories, using fallback method: ${error.message}`
        )
      );
      return [];
    }
  }

  async showRateLimit() {
    try {
      const data = await this.makeRequest("GET /rate_limit");
      const { rate } = data;

      console.log(chalk.blue.bold("\n📊 GitHub API Rate Limit Status:"));
      console.log(`   Limit: ${chalk.green.bold(rate.limit)}`);
      console.log(`   Remaining: ${chalk.green.bold(rate.remaining)}`);
      console.log(`   Used: ${chalk.yellow.bold(rate.used)}`);
      console.log(
        `   Resets at: ${chalk.gray(
          new Date(rate.reset * 1000).toLocaleString()
        )}`
      );

      if (rate.remaining < 10) {
        console.log(chalk.red.bold("   ⚠️  Warning: Rate limit is low!"));
      }
    } catch (error) {
      console.error(chalk.red("❌ Failed to fetch rate limit information"));
    }
  }

  getApiUsageSummary() {
    return {
      totalCalls: this.apiCallCount,
      pathsUsed: Array.from(this.apiPaths),
      auditLog: this.auditLog,
      totalRecordsFetched: this.totalRecordsFetched,
    };
  }

  cleanup() {
    if (this.githubLogStream) {
      this.githubLogStream.end();
    }
  }
}

// Analysis Modules
class PRThroughputAnalyzer {
  constructor(options = {}) {
    this.options = options;
  }

  analyze(pullRequests) {
    // Input validation
    if (!Array.isArray(pullRequests)) {
      throw new Error("PRThroughputAnalyzer expects an array of pull requests");
    }

    // Check for PR-specific properties in first item
    if (pullRequests.length > 0 && !pullRequests[0].hasOwnProperty("number")) {
      throw new Error(
        "PRThroughputAnalyzer received invalid data: missing PR properties"
      );
    }

    const totalPRs = pullRequests.length;
    const statusBreakdown = {
      merged: pullRequests.filter((pr) => pr.merged_at !== null).length,
      closed: pullRequests.filter(
        (pr) => pr.state === "closed" && pr.merged_at === null
      ).length,
      open: pullRequests.filter((pr) => pr.state === "open").length,
    };

    const mergeRate =
      totalPRs > 0 ? (statusBreakdown.merged / totalPRs) * 100 : 0;

    // Calculate average time to merge
    const mergedPRs = pullRequests.filter((pr) => pr.merged_at !== null);
    let avgTimeToMerge = 0;
    if (mergedPRs.length > 0) {
      const totalTime = mergedPRs.reduce((sum, pr) => {
        try {
          const created = new Date(pr.created_at);
          const merged = new Date(pr.merged_at);
          if (isNaN(created.getTime()) || isNaN(merged.getTime())) {
            console.warn(
              chalk.yellow(`Warning: Invalid date format in PR #${pr.number}`)
            );
            return sum;
          }
          return sum + (merged - created);
        } catch (error) {
          console.warn(
            chalk.yellow(
              `Warning: Error calculating time for PR #${pr.number}: ${error.message}`
            )
          );
          return sum;
        }
      }, 0);
      avgTimeToMerge = totalTime / mergedPRs.length / (1000 * 60 * 60 * 24); // Convert to days
    }

    return {
      totalPRs,
      statusBreakdown,
      mergeRate: Math.round(mergeRate * 100) / 100,
      avgTimeToMerge:
        avgTimeToMerge > 0
          ? `${Math.round(avgTimeToMerge * 10) / 10} days`
          : "0 days",
      details: pullRequests.map((pr) => ({
        number: pr.number,
        title: pr.title,
        repository: pr.repository.full_name,
        state: pr.state,
        created_at: pr.created_at,
        merged_at: pr.merged_at,
        closed_at: pr.closed_at,
        additions: pr.additions,
        deletions: pr.deletions,
        changed_files: pr.changed_files,
      })),
    };
  }
}

class CodeChurnAnalyzer {
  constructor(options = {}) {
    this.options = options;
    this.smallCommitThreshold = options.smallCommitThreshold || 50;
    this.largeCommitThreshold = options.largeCommitThreshold || 500;
  }

  analyze(commits, pullRequests = []) {
    // Input validation
    if (!Array.isArray(commits)) {
      throw new Error("CodeChurnAnalyzer expects commits to be an array");
    }
    if (!Array.isArray(pullRequests)) {
      throw new Error("CodeChurnAnalyzer expects pullRequests to be an array");
    }

    const totalCommits = commits.length;
    let totalAdditions = 0;
    let totalDeletions = 0;
    const commitSizeDistribution = { small: 0, medium: 0, large: 0 };

    commits.forEach((commit) => {
      if (commit.stats) {
        totalAdditions += commit.stats.additions;
        totalDeletions += commit.stats.deletions;

        const total = commit.stats.total;
        if (total <= this.smallCommitThreshold) {
          commitSizeDistribution.small++;
        } else if (total <= this.largeCommitThreshold) {
          commitSizeDistribution.medium++;
        } else {
          commitSizeDistribution.large++;
        }
      }
    });

    // Add PR data
    pullRequests.forEach((pr) => {
      totalAdditions += pr.additions || 0;
      totalDeletions += pr.deletions || 0;
    });

    const netChange = totalAdditions - totalDeletions;

    return {
      totalCommits,
      totalAdditions,
      totalDeletions,
      netChange,
      commitSizeDistribution,
      details: commits.map((commit) => ({
        sha: commit.sha,
        message: commit.commit.message,
        author: commit.commit.author,
        repository: commit.repository?.full_name || "unknown",
        stats: commit.stats || { additions: 0, deletions: 0, total: 0 },
      })),
    };
  }
}

class WorkPatternsAnalyzer {
  constructor(options = {}) {
    this.options = options;
    this.businessHours = { start: 9, end: 17 }; // 9 AM to 5 PM
  }

  analyze(commits, pullRequests = []) {
    // Input validation
    if (!Array.isArray(commits)) {
      throw new Error("WorkPatternsAnalyzer expects commits to be an array");
    }
    if (!Array.isArray(pullRequests)) {
      throw new Error(
        "WorkPatternsAnalyzer expects pullRequests to be an array"
      );
    }

    const dayCount = {};
    const hourCount = {};
    const commitPunchcard = {};
    let afterHoursCount = 0;
    let totalActivities = 0;

    // Analyze commits
    commits.forEach((commit) => {
      try {
        const date = new Date(commit.commit.author.date);
        if (isNaN(date.getTime())) {
          console.warn(
            chalk.yellow(`Warning: Invalid date in commit ${commit.sha}`)
          );
          return;
        }

        const day = date.toLocaleDateString("en-US", { weekday: "long" });
        const hour = date.getHours();

        dayCount[day] = (dayCount[day] || 0) + 1;
        hourCount[hour] = (hourCount[hour] || 0) + 1;

        if (!commitPunchcard[day]) commitPunchcard[day] = {};
        commitPunchcard[day][hour] = (commitPunchcard[day][hour] || 0) + 1;

        if (hour < this.businessHours.start || hour >= this.businessHours.end) {
          afterHoursCount++;
        }
        totalActivities++;
      } catch (error) {
        console.warn(
          chalk.yellow(
            `Warning: Error processing commit ${commit.sha}: ${error.message}`
          )
        );
      }
    });

    // Analyze PRs
    pullRequests.forEach((pr) => {
      try {
        const date = new Date(pr.created_at);
        if (isNaN(date.getTime())) {
          console.warn(
            chalk.yellow(`Warning: Invalid date in PR #${pr.number}`)
          );
          return;
        }

        const day = date.toLocaleDateString("en-US", { weekday: "long" });
        const hour = date.getHours();

        dayCount[day] = (dayCount[day] || 0) + 1;
        hourCount[hour] = (hourCount[hour] || 0) + 1;

        if (!commitPunchcard[day]) commitPunchcard[day] = {};
        commitPunchcard[day][hour] = (commitPunchcard[day][hour] || 0) + 1;

        if (hour < this.businessHours.start || hour >= this.businessHours.end) {
          afterHoursCount++;
        }
        totalActivities++;
      } catch (error) {
        console.warn(
          chalk.yellow(
            `Warning: Error processing PR #${pr.number}: ${error.message}`
          )
        );
      }
    });

    // Find most active day
    const mostActiveDay =
      Object.keys(dayCount).length > 0
        ? Object.keys(dayCount).reduce((a, b) =>
            dayCount[a] > dayCount[b] ? a : b
          )
        : "Unknown";

    const afterHoursPercentage =
      totalActivities > 0
        ? Math.round((afterHoursCount / totalActivities) * 10000) / 100
        : 0;

    return {
      mostActiveDay,
      afterHoursPercentage,
      commitPunchcard,
      dayDistribution: dayCount,
      hourDistribution: hourCount,
      totalActivities,
      afterHoursCount,
    };
  }
}

class PRCycleTimeAnalyzer {
  constructor(options = {}) {
    this.options = options;
  }

  analyze(pullRequests) {
    // Input validation
    if (!Array.isArray(pullRequests)) {
      throw new Error("PRCycleTimeAnalyzer expects an array of pull requests");
    }

    // Check for PR-specific properties in first item
    if (pullRequests.length > 0 && !pullRequests[0].hasOwnProperty("number")) {
      throw new Error(
        "PRCycleTimeAnalyzer received invalid data: missing PR properties"
      );
    }

    const cycleTimeData = [];
    let totalCycleTime = 0;
    let mergedCount = 0;

    pullRequests.forEach((pr) => {
      try {
        const created = new Date(pr.created_at);
        let cycleTime = null;

        if (pr.merged_at) {
          const merged = new Date(pr.merged_at);
          if (!isNaN(created.getTime()) && !isNaN(merged.getTime())) {
            cycleTime = (merged - created) / (1000 * 60 * 60 * 24); // Days
            totalCycleTime += cycleTime;
            mergedCount++;
          } else {
            console.warn(
              chalk.yellow(`Warning: Invalid date format in PR #${pr.number}`)
            );
          }
        } else if (pr.closed_at) {
          const closed = new Date(pr.closed_at);
          if (!isNaN(created.getTime()) && !isNaN(closed.getTime())) {
            cycleTime = (closed - created) / (1000 * 60 * 60 * 24); // Days
          } else {
            console.warn(
              chalk.yellow(`Warning: Invalid date format in PR #${pr.number}`)
            );
          }
        }

        cycleTimeData.push({
          number: pr.number,
          title: pr.title,
          repository: pr.repository.full_name,
          created_at: pr.created_at,
          merged_at: pr.merged_at,
          closed_at: pr.closed_at,
          cycleTime: cycleTime ? Math.round(cycleTime * 10) / 10 : null,
          status: pr.merged_at ? "merged" : pr.closed_at ? "closed" : "open",
        });
      } catch (error) {
        console.warn(
          chalk.yellow(
            `Warning: Error processing PR #${pr.number}: ${error.message}`
          )
        );
      }
    });

    const avgCycleTime = mergedCount > 0 ? totalCycleTime / mergedCount : 0;

    return {
      avgCycleTime: Math.round(avgCycleTime * 10) / 10,
      totalPRs: pullRequests.length,
      mergedPRs: mergedCount,
      details: cycleTimeData,
    };
  }
}

// Report Generator with multiple format support
class ReportGenerator {
  constructor(options = {}) {
    this.options = options;
    this.sequelize = null;
  }

  async initializeDatabase() {
    if (!this.options.databaseUrl) {
      throw new Error("Database URL is required for database export");
    }

    this.sequelize = new Sequelize(this.options.databaseUrl, {
      logging: this.options.verbose ? console.log : false,
      dialect: this.options.databaseUrl.includes("postgres")
        ? "postgres"
        : "sqlite",
    });

    // Define models
    this.defineModels();
    await this.sequelize.sync({ force: false });
  }

  defineModels() {
    this.Report = this.sequelize.define("Report", {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      searchUser: { type: DataTypes.STRING, allowNull: false },
      reportVersion: { type: DataTypes.STRING, defaultValue: "1.0" },
      dateRangeStart: { type: DataTypes.DATE, allowNull: true },
      dateRangeEnd: { type: DataTypes.DATE, allowNull: true },
      repositoriesAnalyzed: { type: DataTypes.JSON },
      enabledModules: { type: DataTypes.JSON },
      summary: { type: DataTypes.JSON },
      analytics: { type: DataTypes.JSON },
      rawData: { type: DataTypes.JSON },
      metaTags: { type: DataTypes.JSON },
      generatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    });
  }

  async generateReport(data, format, outputPath) {
    switch (format) {
      case "json":
        return this.generateJSON(data, outputPath);
      case "csv":
        return this.generateCSV(data, outputPath);
      case "html":
        return this.generateHTML(data, outputPath);
      case "database":
        return this.generateDatabase(data);
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  async generateJSON(data, outputPath) {
    const jsonData = JSON.stringify(data, null, 2);
    await fs.writeFile(outputPath, jsonData, "utf8");
    return outputPath;
  }

  async generateCSV(data, outputPath) {
    // Generate summary CSV
    const summaryPath = outputPath.replace(".csv", "-summary.csv");
    const summary = data.summary;
    const summaryHeaders = Object.keys(summary);
    const summaryValues = Object.values(summary);

    let csv = summaryHeaders.join(",") + "\n" + summaryValues.join(",") + "\n";
    await fs.writeFile(summaryPath, csv, "utf8");

    // Generate detailed CSV for PRs
    if (data.analytics.prThroughput?.details) {
      const prPath = outputPath.replace(".csv", "-pull-requests.csv");
      const prDetails = data.analytics.prThroughput.details;
      if (prDetails.length > 0) {
        const headers = Object.keys(prDetails[0]);
        let prCsv = headers.join(",") + "\n";
        prDetails.forEach((pr) => {
          const values = headers.map((h) => JSON.stringify(pr[h] || ""));
          prCsv += values.join(",") + "\n";
        });
        await fs.writeFile(prPath, prCsv, "utf8");
      }
    }

    // Generate detailed CSV for commits
    if (data.analytics.codeChurn?.details) {
      const commitPath = outputPath.replace(".csv", "-commits.csv");
      const commitDetails = data.analytics.codeChurn.details;
      if (commitDetails.length > 0) {
        const headers = [
          "sha",
          "message",
          "author_name",
          "author_email",
          "date",
          "repository",
          "additions",
          "deletions",
          "total",
        ];
        let commitCsv = headers.join(",") + "\n";
        commitDetails.forEach((commit) => {
          const values = [
            JSON.stringify(commit.sha),
            JSON.stringify(commit.message),
            JSON.stringify(commit.author.name),
            JSON.stringify(commit.author.email),
            JSON.stringify(commit.author.date),
            JSON.stringify(commit.repository),
            commit.stats.additions,
            commit.stats.deletions,
            commit.stats.total,
          ];
          commitCsv += values.join(",") + "\n";
        });
        await fs.writeFile(commitPath, commitCsv, "utf8");
      }
    }

    return outputPath;
  }

  async generateHTML(data, outputPath) {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Developer Insights Report - ${data.metadata.searchUser}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px; margin-bottom: 30px; }
        .header h1 { margin: 0; font-size: 2.5em; }
        .header p { margin: 5px 0; opacity: 0.9; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 40px; }
        .metric { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; border-radius: 10px; padding: 25px; text-align: center; }
        .metric-value { font-size: 2.5em; font-weight: bold; margin-bottom: 10px; }
        .metric-label { font-size: 1.1em; opacity: 0.9; }
        .section { margin-bottom: 40px; }
        .section h2 { color: #333; border-bottom: 3px solid #667eea; padding-bottom: 10px; margin-bottom: 20px; }
        .analytics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 30px; }
        .analytics-card { background: #f8f9fa; padding: 25px; border-radius: 10px; border-left: 5px solid #667eea; }
        .analytics-card h3 { margin-top: 0; color: #667eea; }
        .stat { display: flex; justify-content: space-between; margin: 10px 0; padding: 8px 0; border-bottom: 1px solid #eee; }
        .stat:last-child { border-bottom: none; }
        .stat-label { font-weight: bold; color: #555; }
        .stat-value { color: #667eea; font-weight: bold; }
        .repository-list { background: #f8f9fa; padding: 20px; border-radius: 10px; }
        .repository-list ul { list-style: none; padding: 0; margin: 0; }
        .repository-list li { background: white; margin: 5px 0; padding: 10px; border-radius: 5px; border-left: 3px solid #667eea; }
        .footer { text-align: center; margin-top: 40px; padding: 20px; background: #f8f9fa; border-radius: 10px; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 Developer Insights Report</h1>
            <p><strong>Developer:</strong> ${data.metadata.searchUser}</p>
            ${
              data.metadata.dateRange
                ? `<p><strong>Analysis Period:</strong> ${data.metadata.dateRange.start} to ${data.metadata.dateRange.end}</p>`
                : "<p><strong>Analysis Period:</strong> All Time</p>"
            }
            <p><strong>Generated:</strong> ${new Date(
              data.metadata.generatedAt
            ).toLocaleDateString()}</p>
            <p><strong>Report Version:</strong> ${
              data.metadata.reportVersion
            }</p>
        </div>

        <div class="summary">
            <div class="metric">
                <div class="metric-value">${
                  data.summary.totalContributions
                }</div>
                <div class="metric-label">📊 Total Contributions</div>
            </div>
            <div class="metric">
                <div class="metric-value">${data.summary.totalCommits}</div>
                <div class="metric-label">📈 Commits</div>
            </div>
            <div class="metric">
                <div class="metric-value">${data.summary.totalPRsCreated}</div>
                <div class="metric-label">🔀 Pull Requests</div>
            </div>
            <div class="metric">
                <div class="metric-value">${data.summary.linesAdded}</div>
                <div class="metric-label">➕ Lines Added</div>
            </div>
        </div>

        <div class="section">
            <h2>📊 Detailed Analytics</h2>
            <div class="analytics-grid">
                ${
                  data.analytics.prThroughput
                    ? `
                <div class="analytics-card">
                    <h3>🔀 Pull Request Throughput</h3>
                    <div class="stat">
                        <span class="stat-label">Total PRs:</span>
                        <span class="stat-value">${data.analytics.prThroughput.totalPRs}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Merge Rate:</span>
                        <span class="stat-value">${data.analytics.prThroughput.mergeRate}%</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Avg. Time to Merge:</span>
                        <span class="stat-value">${data.analytics.prThroughput.avgTimeToMerge}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Merged:</span>
                        <span class="stat-value">${data.analytics.prThroughput.statusBreakdown.merged}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Open:</span>
                        <span class="stat-value">${data.analytics.prThroughput.statusBreakdown.open}</span>
                    </div>
                </div>
                `
                    : ""
                }

                ${
                  data.analytics.codeChurn
                    ? `
                <div class="analytics-card">
                    <h3>📝 Code Churn Analysis</h3>
                    <div class="stat">
                        <span class="stat-label">Total Commits:</span>
                        <span class="stat-value">${data.analytics.codeChurn.totalCommits}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Lines Added:</span>
                        <span class="stat-value">${data.analytics.codeChurn.totalAdditions}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Lines Deleted:</span>
                        <span class="stat-value">${data.analytics.codeChurn.totalDeletions}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Net Change:</span>
                        <span class="stat-value">${data.analytics.codeChurn.netChange}</span>
                    </div>
                </div>
                `
                    : ""
                }

                ${
                  data.analytics.workPatterns
                    ? `
                <div class="analytics-card">
                    <h3>⏰ Work Patterns</h3>
                    <div class="stat">
                        <span class="stat-label">Most Active Day:</span>
                        <span class="stat-value">${data.analytics.workPatterns.mostActiveDay}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">After Hours Work:</span>
                        <span class="stat-value">${data.analytics.workPatterns.afterHoursPercentage}%</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Total Activities:</span>
                        <span class="stat-value">${data.analytics.workPatterns.totalActivities}</span>
                    </div>
                </div>
                `
                    : ""
                }

                ${
                  data.analytics.prCycleTime
                    ? `
                <div class="analytics-card">
                    <h3>🔄 PR Cycle Time</h3>
                    <div class="stat">
                        <span class="stat-label">Avg. Cycle Time:</span>
                        <span class="stat-value">${data.analytics.prCycleTime.avgCycleTime} days</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Total PRs:</span>
                        <span class="stat-value">${data.analytics.prCycleTime.totalPRs}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Merged PRs:</span>
                        <span class="stat-value">${data.analytics.prCycleTime.mergedPRs}</span>
                    </div>
                </div>
                `
                    : ""
                }
            </div>
        </div>

        <div class="section">
            <h2>📂 Repository Activity</h2>
            <div class="repository-list">
                <p><strong>Repositories Analyzed:</strong> ${
                  data.metadata.repositoriesAnalyzed.length
                }</p>
                <ul>
                    ${data.metadata.repositoriesAnalyzed
                      .map((repo) => `<li>📁 ${repo}</li>`)
                      .join("")}
                </ul>
            </div>
        </div>

        ${
          data.metadata.metaTags &&
          Object.keys(data.metadata.metaTags).length > 0
            ? `
        <div class="section">
            <h2>🏷️ Meta Tags</h2>
            <div class="repository-list">
                <ul>
                    ${Object.entries(data.metadata.metaTags)
                      .map(
                        ([key, value]) =>
                          `<li><strong>${key}:</strong> ${value}</li>`
                      )
                      .join("")}
                </ul>
            </div>
        </div>
        `
            : ""
        }

        <div class="footer">
            <p>Generated by Developer Insights Tool | Report Version ${
              data.metadata.reportVersion
            }</p>
            <p>Analysis Modules: ${data.metadata.enabledModules.join(", ")}</p>
        </div>
    </div>
</body>
</html>`;

    await fs.writeFile(outputPath, html, "utf8");
    return outputPath;
  }

  async generateDatabase(data) {
    if (!this.sequelize) {
      await this.initializeDatabase();
    }

    const reportData = {
      searchUser: data.metadata.searchUser,
      reportVersion: data.metadata.reportVersion,
      repositoriesAnalyzed: data.metadata.repositoriesAnalyzed,
      enabledModules: data.metadata.enabledModules,
      summary: data.summary,
      analytics: data.analytics,
      rawData: data.rawData,
      metaTags: data.metadata.metaTags || {},
      generatedAt: new Date(data.metadata.generatedAt),
    };

    if (data.metadata.dateRange) {
      reportData.dateRangeStart = new Date(data.metadata.dateRange.start);
      reportData.dateRangeEnd = new Date(data.metadata.dateRange.end);
    }

    const report = await this.Report.create(reportData);

    return report.id;
  }

  async generateAuditFile(auditData, outputPath) {
    const auditPath = outputPath.replace(/\.(json|csv|html)$/, ".audit.json");
    const auditJson = JSON.stringify(auditData, null, 2);
    await fs.writeFile(auditPath, auditJson, "utf8");
    return auditPath;
  }
}

// Main Developer Insights Class
class DeveloperInsights {
  constructor(options) {
    try {
      this.config = ConfigSchema.parse(options);
    } catch (error) {
      throw new Error(`Configuration validation failed: ${error.message}`);
    }

    this.dataEngine = new GitHubDataEngine(this.config);
    this.reportGenerator = new ReportGenerator(this.config);

    // Initialize analysis modules
    this.analyzers = {
      prThroughput: new PRThroughputAnalyzer(this.config),
      codeChurn: new CodeChurnAnalyzer(this.config),
      workPatterns: new WorkPatternsAnalyzer(this.config),
      prCycleTime: new PRCycleTimeAnalyzer(this.config),
    };

    this.globalData = null;
    this.loadGlobalData();
  }

  async loadGlobalData() {
    if (this.config.loadData) {
      try {
        const data = await fs.readFile(this.config.loadData, "utf8");
        this.globalData = JSON.parse(data);
        console.log(chalk.green(`✅ Loaded data from ${this.config.loadData}`));
      } catch (error) {
        console.warn(
          chalk.yellow(
            `Warning: Failed to load data from ${this.config.loadData}: ${error.message}`
          )
        );
      }
    }
  }

  displayInitialization() {
    console.log(chalk.blue.bold("🔸 Initialization"));
    console.log(chalk.green("🔧 DeveloperInsights initialized"));

    const params = [
      ["👤 Search user", this.config.searchUser],
      [
        "📅 Date range",
        this.config.ignoreDateRange
          ? "All time"
          : `${this.config.start || "Auto"} to ${this.config.end || "Auto"}`,
      ],
      ["🏢 Organization", this.config.org || "All organizations"],
      ["📂 Repositories", this.config.repo || "All repositories"],
      ["📄 Output format", this.config.format.toUpperCase()],
      ["💾 Output directory", this.config.outputDir],
      [
        "📊 Total records limit",
        this.config.totalRecords === 0 ? "No limit" : this.config.totalRecords,
      ],
      ["⏱️ API delay", `${this.config.delay}s`],
      ["🔍 Verbose mode", this.config.verbose ? "Enabled" : "Disabled"],
      ["🐛 Debug mode", this.config.debug ? "Enabled" : "Disabled"],
    ];

    const maxLabelLength = Math.max(...params.map(([label]) => label.length));

    params.forEach(([label, value]) => {
      const padding = "─".repeat(maxLabelLength - label.length);
      console.log(`${label} ${padding} ${value}`);
    });

    console.log(
      chalk.blue.bold("\n🚀 Starting GitHub developer insights analysis...\n")
    );
  }

  async validateInputs() {
    console.log(chalk.blue.bold("🔸 User Validation"));

    try {
      await this.dataEngine.validateUser(this.config.searchUser);
      console.log(chalk.green(`✅ User ${this.config.searchUser} validated`));
    } catch (error) {
      throw new Error(`User validation failed: ${error.message}`);
    }
  }

  async fetchAllData() {
    console.log(chalk.blue.bold("🔸 Data Collection"));

    const pullRequests = await CLIProgressHelper.withProgress(
      1,
      "🔍 Fetching pull requests...",
      async (update) => {
        const prs = await this.dataEngine.fetchPullRequests(
          this.config.searchUser,
          this.config.start,
          this.config.end,
          this.config.org,
          this.config.repo
        );
        update(1);
        return prs;
      }
    );

    console.log(chalk.green(`📂 Found ${pullRequests.length} pull requests`));

    // Discover repositories if not specified
    let repositories = [];
    if (this.config.repo) {
      repositories = this.config.repo.split(",").map((r) => r.trim());
    } else if (pullRequests.length > 0) {
      repositories = [
        ...new Set(pullRequests.map((pr) => pr.repository.full_name)),
      ];
    } else {
      repositories = await this.dataEngine.discoverUserRepositories(
        this.config.searchUser,
        this.config.start,
        this.config.end
      );
    }

    console.log(
      chalk.green(`📂 Analyzing ${repositories.length} repositories`)
    );

    const commits = await CLIProgressHelper.withProgress(
      1,
      "📊 Fetching commits...",
      async (update) => {
        const cmts = await this.dataEngine.fetchCommits(
          this.config.searchUser,
          this.config.start,
          this.config.end,
          repositories
        );
        update(1);
        return cmts;
      }
    );

    console.log(chalk.green(`📂 Found ${commits.length} commits`));

    return { pullRequests, commits, repositories };
  }

  async performAnalysis(data) {
    console.log(chalk.blue.bold("🔸 Analysis Phase"));

    const { pullRequests, commits } = data;
    const enabledModules = this.config.modules.split(",").map((m) => m.trim());
    const analytics = {};

    for (const moduleName of enabledModules) {
      if (this.analyzers[moduleName]) {
        console.log(chalk.gray(`  Analyzing ${moduleName}...`));

        // Route parameters based on analyzer requirements
        try {
          switch (moduleName) {
            case "prThroughput":
            case "prCycleTime":
              analytics[moduleName] =
                this.analyzers[moduleName].analyze(pullRequests);
              break;
            case "codeChurn":
            case "workPatterns":
              analytics[moduleName] = this.analyzers[moduleName].analyze(
                commits,
                pullRequests
              );
              break;
            default:
              // Fallback for unknown modules
              analytics[moduleName] = this.analyzers[moduleName].analyze(
                commits,
                pullRequests
              );
          }
        } catch (error) {
          console.warn(
            chalk.yellow(
              `Warning: Failed to analyze ${moduleName}: ${error.message}`
            )
          );
          analytics[moduleName] = {
            error: error.message,
            timestamp: new Date().toISOString(),
          };
        }
      }
    }

    return analytics;
  }

  generateSummary(data, analytics) {
    const { pullRequests, commits } = data;

    return {
      totalContributions: commits.length + pullRequests.length,
      totalCommits: commits.length,
      totalPRsCreated: pullRequests.length,
      totalReviewsSubmitted: 0, // Would need additional API calls
      totalComments: 0, // Would need additional API calls
      linesAdded: analytics.codeChurn?.totalAdditions || 0,
      linesDeleted: analytics.codeChurn?.totalDeletions || 0,
      primaryLanguages: [], // Would need repository language analysis
    };
  }

  async generateReport(data, analytics, repositories) {
    console.log(chalk.blue.bold("🔸 Report Generation"));

    const summary = this.generateSummary(data, analytics);

    const report = {
      metadata: {
        reportVersion: "1.0",
        searchUser: this.config.searchUser,
        repositoriesAnalyzed: repositories,
        generatedAt: new Date().toISOString(),
        enabledModules: this.config.modules.split(",").map((m) => m.trim()),
        metaTags: this.config.metaTags || {},
        inputs: {
          searchUser: this.config.searchUser,
          org: this.config.org,
          repo: this.config.repo,
          format: this.config.format,
          outputDir: this.config.outputDir,
          filename: this.config.filename,
          ignoreDateRange: this.config.ignoreDateRange,
          start: this.config.start,
          end: this.config.end,
          totalRecords: this.config.totalRecords,
          delay: this.config.delay,
          partitionStrategy: this.config.partitionStrategy,
          fetchStrategy: this.config.fetchStrategy,
          modules: this.config.modules,
        },
        criteria: [
          `Pull requests filtered by author:${this.config.searchUser} and user:${this.config.searchUser}`,
          `Commits filtered by author:${this.config.searchUser}`,
          !this.config.ignoreDateRange && this.config.start && this.config.end
            ? `Date range: ${this.config.start} to ${this.config.end}`
            : "Date range: All time",
          this.config.org ? `Organization scope: ${this.config.org}` : null,
          this.config.repo ? `Repository scope: ${this.config.repo}` : null,
          this.config.totalRecords > 0
            ? `Total records limit: ${this.config.totalRecords}`
            : null,
        ].filter(Boolean),
        formula: [
          "Merge Rate = (Merged PRs / Total PRs) * 100",
          "Average Time to Merge = Sum(Merge Time) / Count(Merged PRs)",
          "Net Code Change = Total Additions - Total Deletions",
          "After Hours Percentage = (After Hours Activities / Total Activities) * 100",
          "Average Cycle Time = Sum(Cycle Times) / Count(Merged PRs)",
        ],
      },
      summary,
      analytics,
      rawData: this.config.debug ? data : {},
    };

    // Add date range only if not ignoring dates
    if (!this.config.ignoreDateRange && this.config.start && this.config.end) {
      report.metadata.dateRange = {
        start: this.config.start,
        end: this.config.end,
      };
    }

    // Ensure output directory exists
    await fs.mkdir(this.config.outputDir, { recursive: true });

    // Generate filename
    const timestamp = new Date().toISOString().split("T")[0];
    const baseFilename =
      this.config.filename ||
      `developer-insights-${this.config.searchUser}-${timestamp}`;

    let outputPath;
    switch (this.config.format) {
      case "json":
        outputPath = path.join(this.config.outputDir, `${baseFilename}.json`);
        break;
      case "csv":
        outputPath = path.join(this.config.outputDir, `${baseFilename}.csv`);
        break;
      case "html":
        outputPath = path.join(this.config.outputDir, `${baseFilename}.html`);
        break;
      case "database":
        outputPath = "database";
        break;
      default:
        outputPath = path.join(this.config.outputDir, `${baseFilename}.json`);
    }

    const result = await this.reportGenerator.generateReport(
      report,
      this.config.format,
      outputPath
    );

    if (this.config.format !== "database") {
      console.log(chalk.green(`📄 Report saved: ${result}`));
    } else {
      console.log(
        chalk.green(`💾 Report saved to database with ID: ${result}`)
      );
    }

    // Generate audit file if debug mode
    if (this.config.debug && this.config.format !== "database") {
      const apiUsage = this.dataEngine.getApiUsageSummary();
      const auditPath = await this.reportGenerator.generateAuditFile(
        apiUsage,
        outputPath
      );
      console.log(chalk.gray(`🔍 Audit file: ${auditPath}`));
    }

    return { report, outputPath: result };
  }

  displaySummary(report, outputPath) {
    const usage = this.dataEngine.getApiUsageSummary();

    console.log(chalk.blue.bold("\n📊 GitHub API Usage Summary:"));
    console.log("────────────────────────────────────────────────────────────");
    console.log(`Total API calls: ${usage.totalCalls}`);
    console.log(`Total records fetched: ${usage.totalRecordsFetched}`);
    console.log(`API paths used: ${usage.pathsUsed.join(", ")}`);

    console.log(chalk.green.bold("\n✅ Analysis completed successfully!"));

    console.log(chalk.blue.bold("\n📊 Final Report Summary"));
    console.log("────────────────────────────────────────────────────────────");
    console.log(
      `📊 Total Pull Requests    : ${report.summary.totalPRsCreated}`
    );
    console.log(
      `📂 Repositories Analyzed  : ${report.metadata.repositoriesAnalyzed.length}`
    );
    console.log(`📈 Total Commits          : ${report.summary.totalCommits}`);
    console.log(`➕ Total Additions         : ${report.summary.linesAdded}`);
    console.log(`➖ Total Deletions         : ${report.summary.linesDeleted}`);
    if (this.config.format !== "database") {
      console.log(`📄 Report Location        : ${outputPath}`);
    }
    console.log("────────────────────────────────────────────────────────────");
  }

  async run() {
    try {
      this.displayInitialization();
      await this.validateInputs();

      const data = await this.fetchAllData();
      const analytics = await this.performAnalysis(data);
      const { report, outputPath } = await this.generateReport(
        data,
        analytics,
        data.repositories
      );

      await this.dataEngine.showRateLimit();
      this.displaySummary(report, outputPath);

      return { success: true, report, outputPath };
    } catch (error) {
      writeFileSync(
        path.join(
          this.config.outputDir,
          `dashboard-${this.config.filename}.errors.json`
        ),
        JSON.stringify({
          errors: [error.message],
          inputs: {
            ...this.config,
            userProfile: `https://${process.env.GITHUB_HOSTNAME}/${this.config.searchUser}?tab=overview`,
          },
        })
      );

      console.error(chalk.red(`❌ Error: ${error.message}`));
      if (this.config.debug) {
        console.error(error.stack);
      }
      return { success: false, error: error.message };
    } finally {
      this.dataEngine.cleanup();
    }
  }
}

// CLI Setup
const program = new Command();

program
  .name("developer-insights")
  .description(
    "Generate comprehensive individual efficiency reports for performance reviews"
  )
  .version("1.0.0")
  .option("--org <org>", "GitHub organization")
  .option("--repo <repo>", "Comma-separated list of repository names")
  .option(
    "--searchUser <userIdentifier>",
    "GitHub username to analyze (required)"
  )
  .option(
    "--meta-tags <tag>",
    "Meta tags in KEY=VALUE format (can be repeated)",
    (value, previous) => {
      const [key, val] = value.split("=");
      return { ...previous, [key]: val };
    },
    {}
  )
  .option(
    "--format <format>",
    "Output format: json, csv, html, database",
    "json"
  )
  .option("--outputDir <directory>", "Output directory", "./output")
  .option("--filename <filename>", "Base filename for output")
  .option("--ignoreDateRange", "Ignore all date range filters", false)
  .option("--start <date>", "Start date (YYYY-MM-DD)")
  .option("--end <date>", "End date (YYYY-MM-DD)")
  .option("--token <token>", "GitHub personal access token")
  .option("--verbose", "Enable verbose logging", false)
  .option("--debug", "Enable debug mode with audit files", false)
  .option("--loadData <filepath>", "Load data from JSON file")
  .option("--totalRecords <number>", "Total records limit (0 = no limit)", "0")
  .option("--delay <seconds>", "Delay between API requests", "6")
  .option(
    "--partitionStrategy <strategy>",
    "Partitioning strategy: time, size, auto",
    "auto"
  )
  .option(
    "--fetchStrategy <strategy>",
    "Fetch strategy: commits-by-date, code-by-size, repos-by-date",
    "commits-by-date"
  )
  .option(
    "--modules <modules>",
    "Comma-separated analysis modules",
    "prThroughput,codeChurn,workPatterns,prCycleTime"
  )
  .option("--databaseUrl <url>", "Database URL for database export");

async function main() {
  program.parse();
  const options = program.opts();

  try {
    // Set default dates if not provided and not ignoring date range
    if (!options.ignoreDateRange && (!options.start || !options.end)) {
      const today = new Date();
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(today.getDate() - 30);

      options.start =
        options.start || thirtyDaysAgo.toISOString().split("T")[0];
      options.end = options.end || today.toISOString().split("T")[0];
    }

    // Validate required fields
    if (!options.searchUser) {
      console.error(chalk.red("❌ Error: --searchUser is required"));
      program.help();
      process.exit(1);
    }

    // Validate dates are not in the future (only if not ignoring date range)
    if (!options.ignoreDateRange && options.start && options.end) {
      const today = new Date();
      const startDate = new Date(options.start);
      const endDate = new Date(options.end);

      if (startDate > today || endDate > today) {
        console.error(
          chalk.red("❌ Error: Start and end dates cannot be in the future")
        );
        process.exit(1);
      }

      if (startDate >= endDate) {
        console.error(
          chalk.red("❌ Error: Start date must be before end date")
        );
        process.exit(1);
      }
    }

    // Convert numeric options
    if (typeof options.totalRecords === "string") {
      options.totalRecords = parseInt(options.totalRecords, 10);
    }
    if (typeof options.delay === "string") {
      options.delay = parseInt(options.delay, 10);
    }

    // Set token from environment if not provided
    options.token = options.token || process.env.GITHUB_TOKEN;

    // Rename meta-tags to metaTags for consistency
    options.metaTags = options["meta-tags"] || {};

    const analyzer = new DeveloperInsights(options);
    const result = await analyzer.run();

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    writeFileSync(
      path.join(
        this.config.outputDir,
        `dashboard-${this.config.filename}.fails.json`
      ),
      JSON.stringify({
        errors: [error.message],
        inputs: {
          ...this.config,
          userProfile: `https://${process.env.GITHUB_HOSTNAME}/${this.config.searchUser}?tab=overview`,
        },
      })
    );

    console.error(chalk.red(`❌ Fatal error: ${error.message}`));
    if (options.debug) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export {
  DeveloperInsights,
  GitHubDataEngine,
  PRThroughputAnalyzer,
  CodeChurnAnalyzer,
  WorkPatternsAnalyzer,
  PRCycleTimeAnalyzer,
  ReportGenerator,
};
