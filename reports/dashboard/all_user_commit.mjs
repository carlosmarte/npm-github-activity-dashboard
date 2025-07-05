#!/usr/bin/env node

/**
 * Project: all_user_commit
 * Purpose: Analyze all commits made by a GitHub user within a date range, categorizing them as direct commits or pull request commits
 * Description: This CLI tool searches for all commits made by a specified GitHub user either directly to repositories or via pull requests. It provides comprehensive analysis of user commit activity with detailed categorization and grouping using a repository-based approach to overcome GitHub API limitations.
 *
 * Requirements Summary:
 * - Get all user commits either directly to repo or via pull-request
 * - Track whether user committed directly or commit is part of a pull request
 * - Group results by repository or PR number
 * - Support date range filtering
 * - Handle GitHub API limitations with repository-based approach
 * - Generate comprehensive JSON/CSV reports
 * - Include enhanced commit details: parents, stats, and files
 *
 * JSON Report Structure Example:
 * {
 *   "inputs": { "searchUser": "username", "start": "2024-01-01", "end": "2024-12-31" },
 *   "summary": { "totalCommits": 150, "directCommits": 120, "pullRequestCommits": 30, "repositories": 15 },
 *   "commits": [
 *     {
 *       "sha": "abc123", "message": "Fix bug", "date": "2024-01-15", "repository": "owner/repo",
 *       "type": "direct", "pullRequest": null, "author": "user", "url": "https://github.com/...",
 *       "parents": [{"sha": "def456", "url": "...", "html_url": "..."}],
 *       "stats": {"total": 40, "additions": 20, "deletions": 20},
 *       "files": [{"filename": "file.js", "status": "modified", "additions": 1, "deletions": 1, "changes": 2}]
 *     }
 *   ],
 *   "groupedByRepository": { "owner/repo": { "direct": 10, "pullRequest": 5, "commits": [...] } },
 *   "groupedByPullRequest": { "123": { "repository": "owner/repo", "commits": [...] } }
 * }
 *
 * Potential Insights:
 * - User's preferred contribution method (direct vs PR)
 * - Most active repositories
 * - Commit patterns over time
 * - Pull request vs direct commit ratio
 * - Code change patterns (additions vs deletions)
 * - File modification patterns
 */

// Set environment variables at the top
process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN;
process.env.GITHUB_BASE_API_URL =
  process.env.GITHUB_BASE_API_URL || "https://api.github.com";

import { Command } from "commander";
import { Octokit } from "octokit";
import {
  CLIProgressHelper,
  ProgressBar,
  Colors,
} from "@thinkeloquent/cli-progressor";
import { API_Rate_Limiter } from "@thinkeloquent/npm-api-rate-limiter";
import chalk from "chalk";
import { z } from "zod";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { expect } from "expect";
import { writeFileSync, writeSync } from "fs";

dotenv.config();

// Zod schemas for validation
const CommitParentSchema = z.object({
  sha: z.string(),
  url: z.string(),
  html_url: z.string(),
});

const CommitStatsSchema = z.object({
  total: z.number(),
  additions: z.number(),
  deletions: z.number(),
});

const CommitFileSchema = z.object({
  sha: z.string().optional(),
  filename: z.string(),
  status: z.string(),
  additions: z.number(),
  deletions: z.number(),
  changes: z.number(),
  blob_url: z.string().optional(),
  raw_url: z.string().optional(),
  contents_url: z.string().optional(),
  patch: z.string().optional(),
});

const CommitSchema = z.object({
  sha: z.string(),
  message: z.string(),
  date: z.string(),
  repository: z.string(),
  type: z.enum(["direct", "pull_request"]),
  pullRequest: z.number().nullable(),
  author: z.string(),
  url: z.string(),
  parents: z.array(CommitParentSchema).optional(),
  stats: CommitStatsSchema.optional(),
  files: z.array(CommitFileSchema).optional(),
});

const ConfigSchema = z.object({
  searchUser: z.string().min(1),
  org: z.string().optional(),
  repo: z.string().optional(),
  format: z.enum(["json", "csv"]).default("json"),
  outputDir: z.string().default("./output"),
  filename: z.string().optional(),
  ignoreDateRange: z.boolean().default(false),
  start: z.string().optional(),
  end: z.string().optional(),
  token: z.string().min(1),
  verbose: z.boolean().default(false),
  debug: z.boolean().default(false),
  loadData: z.string().optional(),
  totalRecords: z.number().default(0),
  partitionBy: z.string().default("created"),
  delay: z.number().default(6),
  includeDetails: z.boolean().default(true),
  metaTags: z.record(z.string()).default({}),
});

class AllUserCommit {
  constructor(options) {
    // Fix token configuration order to prevent override
    this.options = {
      ...options,
      token: options.token || process.env.GITHUB_TOKEN,
      verbose: options.verbose || false,
      debug: options.debug || false,
    };

    // Validate configuration
    const configResult = ConfigSchema.safeParse(this.options);
    if (!configResult.success) {
      console.error(chalk.red("❌ Configuration validation failed:"));
      configResult.error.errors.forEach((err) => {
        console.error(chalk.red(`  - ${err.path.join(".")}: ${err.message}`));
      });
      process.exit(1);
    }

    this.config = configResult.data;

    // Initialize Octokit with base URL
    this.octokit = new Octokit({
      auth: this.config.token,
      baseUrl: process.env.GITHUB_BASE_API_URL || "https://api.github.com",
    });

    this.commits = [];
    this.errors = [];
    this.apiCalls = [];
    this.LOAD_DATA = null;
    this.totalFetched = 0;
    this.cancelled = false;

    // Initialize rate limiters
    this.initializeRateLimiters();

    // Set up graceful cancellation handler
    process.on("SIGINT", async () => {
      console.log(chalk.yellow("\n⚠️  Gracefully stopping..."));
      this.cancelled = true;
      await this.savePartialResults();
      process.exit(0);
    });

    // Load external data if provided
    if (this.config.loadData) {
      this.loadExternalData();
    }

    this.log("🔧 AllUserCommit initialized");
  }

  async initializeRateLimiters() {
    // Function to get GitHub rate limit for specific resource
    const getGitHubRateLimit = async (resource = "core") => {
      try {
        const response = await this.octokit.request("GET /rate_limit");
        return response.data.resources[resource];
      } catch (error) {
        this.log(
          `Failed to fetch rate limit, using safe defaults: ${error.message}`,
          "warn"
        );
        return { remaining: 1, reset: Math.floor(Date.now() / 1000) + 60 };
      }
    };

    // Core API limiter (repositories, commits, etc.)
    this.coreLimiter = new API_Rate_Limiter("github-core", {
      getRateLimitStatus: () => getGitHubRateLimit("core"),
    });

    // Search API limiter (limited to ~10 requests per minute)
    this.searchLimiter = new API_Rate_Limiter("github-search", {
      getRateLimitStatus: () => getGitHubRateLimit("search"),
    });
  }

  async loadExternalData() {
    try {
      const data = await fs.readFile(this.config.loadData, "utf8");
      this.LOAD_DATA = JSON.parse(data);
      this.log(`📁 External data loaded from ${this.config.loadData}`);
    } catch (error) {
      console.error(
        chalk.red(`❌ Failed to load external data: ${error.message}`)
      );
      process.exit(1);
    }
  }

  log(message, level = "info") {
    if (this.config.verbose || level === "error") {
      const timestamp = new Date().toISOString();
      const coloredMessage =
        level === "error"
          ? chalk.red(message)
          : level === "warn"
          ? chalk.yellow(message)
          : chalk.blue(message);
      console.log(`${chalk.gray(timestamp)} ${coloredMessage}`);
    }
  }

  async debugLog(operation, data) {
    if (this.config.debug) {
      const logEntry = {
        timestamp: new Date().toISOString(),
        operation,
        data,
      };

      try {
        await fs.appendFile("github.log", JSON.stringify(logEntry) + "\n");
      } catch (error) {
        console.error(
          chalk.red(`❌ Failed to write debug log: ${error.message}`)
        );
      }
    }
  }

  async makeRequest(url, options = {}, limiter = null) {
    const startTime = Date.now();
    const requestLimiter = limiter || this.coreLimiter;

    try {
      this.log(`🔍 API Request: ${url}`);

      const response = await requestLimiter.schedule(async () => {
        return await this.octokit.request(url, options);
      });

      const duration = Date.now() - startTime;
      this.apiCalls.push({
        url,
        duration,
        status: response.status,
        timestamp: new Date().toISOString(),
      });

      await this.debugLog("api_request", {
        url,
        options,
        response: response.data,
        duration,
      });

      // Validate response with expect for critical endpoints
      expect(response.status).toBe(200);

      return response.data;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.apiCalls.push({
        url,
        duration,
        status: error.status || "ERROR",
        error: error.message,
        timestamp: new Date().toISOString(),
      });

      await this.debugLog("api_error", {
        url,
        options,
        error: error.message,
        duration,
      });

      throw error;
    }
  }

  async validateUser(username) {
    try {
      const user = await this.makeRequest(`GET /users/${username}`);
      this.log(`✅ User '${username}' validated`);
      expect(user.login).toBe(username);
      return user;
    } catch (error) {
      if (error.status === 404) {
        throw new Error(`User '${username}' not found`);
      }
      throw new Error(`Failed to validate user: ${error.message}`);
    }
  }

  checkTotalRecordsLimit() {
    return (
      this.config.totalRecords > 0 &&
      this.totalFetched >= this.config.totalRecords
    );
  }

  getRemainingRecords() {
    if (this.config.totalRecords === 0) return Number.MAX_SAFE_INTEGER;
    return Math.max(0, this.config.totalRecords - this.totalFetched);
  }

  async getUserRepositories(username) {
    const repos = [];
    let page = 1;

    while (!this.cancelled && !this.checkTotalRecordsLimit()) {
      try {
        const remainingRecords = this.getRemainingRecords();
        const response = await this.makeRequest(
          `GET /users/${username}/repos`,
          {
            page,
            per_page: Math.min(100, remainingRecords),
            type: "all",
            sort: "updated",
            direction: "desc",
          }
        );

        if (response.length === 0) break;
        repos.push(...response);
        this.totalFetched += response.length;

        if (response.length < 100) break;
        if (this.checkTotalRecordsLimit()) {
          const excess = this.totalFetched - this.config.totalRecords;
          if (excess > 0) {
            repos.splice(-excess);
            this.totalFetched = this.config.totalRecords;
          }
          break;
        }

        page++;
        await this.delay(this.config.delay * 1000);
      } catch (error) {
        this.errors.push({
          operation: "getUserRepositories",
          username,
          error: error.message,
        });
        break;
      }
    }

    return repos;
  }

  async getDetailedCommitInfo(owner, repo, sha) {
    try {
      const details = await this.makeRequest(
        `GET /repos/${owner}/${repo}/commits/${sha}`
      );

      return {
        parents:
          details.parents?.map((parent) => ({
            sha: parent.sha,
            url: parent.url,
            html_url: parent.html_url,
          })) || [],
        stats: {
          total: details.stats?.total || 0,
          additions: details.stats?.additions || 0,
          deletions: details.stats?.deletions || 0,
        },
        files:
          details.files?.map((file) => ({
            sha: file.sha,
            filename: file.filename,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            changes: file.changes,
            blob_url: file.blob_url,
            raw_url: file.raw_url,
            contents_url: file.contents_url,
            patch: file.patch,
          })) || [],
      };
    } catch (error) {
      this.log(
        `Failed to get detailed info for ${sha}: ${error.message}`,
        "warn"
      );
      return {
        parents: [],
        stats: { total: 0, additions: 0, deletions: 0 },
        files: [],
      };
    }
  }

  async getRepositoryCommits(owner, repo, author, dateRange = null) {
    const commits = [];
    let page = 1;
    const perPage = 100;

    while (!this.cancelled && !this.checkTotalRecordsLimit()) {
      try {
        const remainingRecords = this.getRemainingRecords();
        const requestOptions = {
          author,
          page,
          per_page: Math.min(perPage, remainingRecords),
        };

        // Add date filtering if provided
        if (dateRange && !this.config.ignoreDateRange) {
          requestOptions.since = new Date(dateRange.start).toISOString();
          requestOptions.until = new Date(dateRange.end).toISOString();
        }

        const response = await this.makeRequest(
          `GET /repos/${owner}/${repo}/commits`,
          requestOptions
        );

        if (response.length === 0) break;

        // Transform to match expected format
        const formatted = await Promise.all(
          response.map(async (commit) => {
            const baseCommit = {
              sha: commit.sha,
              message: commit.commit.message,
              date: commit.commit.committer.date,
              repository: `${owner}/${repo}`,
              type: "direct",
              pullRequest: null,
              author: commit.commit.author.name,
              url: commit.html_url,
            };

            // Get detailed information if enabled
            if (this.config.includeDetails) {
              const details = await this.getDetailedCommitInfo(
                owner,
                repo,
                commit.sha
              );
              baseCommit.parents = details.parents;
              baseCommit.stats = details.stats;
              baseCommit.files = details.files;
              await this.delay(this.config.delay * 1000);
            } else {
              baseCommit.parents = [];
              baseCommit.stats = { total: 0, additions: 0, deletions: 0 };
              baseCommit.files = [];
            }

            // Validate commit structure
            expect(() => CommitSchema.parse(baseCommit)).not.toThrow();

            return baseCommit;
          })
        );

        commits.push(...formatted);
        this.totalFetched += formatted.length;

        if (response.length < perPage) break;
        if (this.checkTotalRecordsLimit()) {
          const excess = this.totalFetched - this.config.totalRecords;
          if (excess > 0) {
            commits.splice(-excess);
            this.totalFetched = this.config.totalRecords;
          }
          break;
        }

        page++;
        await this.delay(this.config.delay * 1000);
      } catch (error) {
        if (error.status === 409 || error.status === 404) {
          // Empty repository or not found, skip
          this.log(
            `⚠️ Skipping repository ${owner}/${repo}: ${error.message}`,
            "warn"
          );
          break;
        }
        this.errors.push({
          operation: "getRepositoryCommits",
          repository: `${owner}/${repo}`,
          error: error.message,
        });
        break;
      }
    }

    return commits;
  }

  async searchUserRepositoryCommits(searchUser, dateRange = null) {
    let allCommits = [];

    // Step 1: Get user's repositories
    const repos = await this.getUserRepositories(searchUser);
    this.log(`📂 Found ${repos.length} repositories for user ${searchUser}`);

    // Filter repositories if org or repo specified
    const filteredRepos = repos.filter((repo) => {
      if (this.config.org && repo.owner.login !== this.config.org) {
        return false;
      }
      if (this.config.repo) {
        const repoNames = this.config.repo.split(",").map((r) => r.trim());
        return repoNames.includes(repo.name);
      }
      return true;
    });

    this.log(
      `📂 Processing ${filteredRepos.length} repositories after filtering`
    );

    // Step 2: For each repo, get commits by the user
    for (const repo of filteredRepos) {
      if (this.cancelled || this.checkTotalRecordsLimit()) break;

      this.log(`🔍 Searching commits in ${repo.full_name}`);
      const repoCommits = await this.getRepositoryCommits(
        repo.owner.login,
        repo.name,
        searchUser,
        dateRange
      );

      allCommits.push(...repoCommits);

      if (this.checkTotalRecordsLimit()) {
        break;
      }
    }

    return allCommits;
  }

  async searchPullRequestsWithPartitioning(searchUser, dateRange = null) {
    // Implement dual search strategy: author: and user:
    const searchPromises = [
      this.searchPullRequestsForUser(`author:${searchUser}`, dateRange),
      this.searchPullRequestsForUser(`user:${searchUser}`, dateRange),
    ];

    const [authorResults, userResults] = await Promise.all(searchPromises);
    const allPullRequests = [...authorResults, ...userResults];

    // Remove duplicates based on PR number and repository
    const uniquePRs = allPullRequests.filter(
      (pr, index, self) =>
        index ===
        self.findIndex(
          (p) =>
            p.number === pr.number && p.repository_url === pr.repository_url
        )
    );

    // Apply totalRecords limit to PRs
    if (this.config.totalRecords > 0) {
      const remainingRecords = this.getRemainingRecords();
      if (uniquePRs.length > remainingRecords) {
        uniquePRs.splice(remainingRecords);
      }
      this.totalFetched += uniquePRs.length;
    }

    return uniquePRs;
  }

  async searchPullRequestsForUser(baseQuery, dateRange = null) {
    const allPullRequests = [];
    let query = `${baseQuery} is:pr`;

    // Add organization filter if specified
    if (this.config.org) {
      query += ` org:${this.config.org}`;
    }

    // Add repository filter if specified
    if (this.config.repo) {
      const repoNames = this.config.repo.split(",").map((r) => r.trim());
      if (this.config.org) {
        const repoQueries = repoNames.map(
          (name) => `repo:${this.config.org}/${name}`
        );
        query = `${baseQuery} is:pr (${repoQueries.join(" OR ")})`;
      } else {
        const repoQueries = repoNames.map((name) => `repo:*/${name}`);
        query = `${baseQuery} is:pr (${repoQueries.join(" OR ")})`;
      }
    }

    // Implement partitioning for date ranges to handle >1000 results
    if (dateRange && !this.config.ignoreDateRange) {
      const partitions = this.createDatePartitions(
        dateRange.start,
        dateRange.end
      );

      for (const partition of partitions) {
        if (this.cancelled || this.checkTotalRecordsLimit()) break;

        const partitionQuery = `${query} created:${partition.start}..${partition.end}`;
        const partitionResults = await this.searchPullRequestsForQuery(
          partitionQuery
        );
        allPullRequests.push(...partitionResults);

        if (this.checkTotalRecordsLimit()) {
          const excess = allPullRequests.length - this.getRemainingRecords();
          if (excess > 0) {
            allPullRequests.splice(-excess);
          }
          break;
        }
      }
    } else {
      const results = await this.searchPullRequestsForQuery(query);
      allPullRequests.push(...results);
    }

    return allPullRequests;
  }

  createDatePartitions(startDate, endDate) {
    const partitions = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Create weekly partitions to stay under 1000 result limit
    let current = new Date(start);

    while (current < end) {
      const partitionEnd = new Date(current);
      partitionEnd.setDate(partitionEnd.getDate() + 7); // Weekly partitions

      if (partitionEnd > end) {
        partitionEnd.setTime(end.getTime());
      }

      partitions.push({
        start: current.toISOString().split("T")[0],
        end: partitionEnd.toISOString().split("T")[0],
      });

      current.setDate(current.getDate() + 8); // Move to next week
    }

    return partitions;
  }

  async searchPullRequestsForQuery(query) {
    const pullRequests = [];
    let page = 1;
    const perPage = 100;

    while (!this.cancelled && !this.checkTotalRecordsLimit()) {
      try {
        const remainingRecords = this.getRemainingRecords();

        // Use the REST API for issues which includes pull requests
        const response = await this.makeRequest(
          "GET /search/issues",
          {
            q: query,
            page,
            per_page: Math.min(perPage, remainingRecords),
            sort: "created",
            order: "desc",
          },
          this.searchLimiter
        );

        // Validate search response structure
        expect(response).toHaveProperty("items");
        expect(Array.isArray(response.items)).toBe(true);

        if (response.items.length === 0) break;

        pullRequests.push(...response.items);

        if (response.items.length < perPage) break;
        if (this.checkTotalRecordsLimit()) {
          const excess = pullRequests.length - this.getRemainingRecords();
          if (excess > 0) {
            pullRequests.splice(-excess);
          }
          break;
        }

        page++;
        await this.delay(this.config.delay * 1000);
      } catch (error) {
        if (
          error.status === 422 &&
          error.message.includes("Only the first 1000")
        ) {
          this.log(
            "⚠️ Reached 1000 result limit for PRs, stopping pagination",
            "warn"
          );
          break;
        }
        throw error;
      }
    }

    return pullRequests;
  }

  async getPullRequestCommits(owner, repo, pullNumber) {
    try {
      const commits = await this.makeRequest(
        `GET /repos/${owner}/${repo}/pulls/${pullNumber}/commits`
      );

      const enhancedCommits = await Promise.all(
        commits.map(async (commit) => {
          const baseCommit = {
            sha: commit.sha,
            message: commit.commit.message,
            date: commit.commit.committer.date,
            repository: `${owner}/${repo}`,
            type: "pull_request",
            pullRequest: pullNumber,
            author: commit.commit.author.name,
            url: commit.html_url,
          };

          // Get detailed information if enabled
          if (this.config.includeDetails) {
            const details = await this.getDetailedCommitInfo(
              owner,
              repo,
              commit.sha
            );
            baseCommit.parents = details.parents;
            baseCommit.stats = details.stats;
            baseCommit.files = details.files;
            await this.delay(this.config.delay * 1000);
          } else {
            baseCommit.parents = [];
            baseCommit.stats = { total: 0, additions: 0, deletions: 0 };
            baseCommit.files = [];
          }

          return baseCommit;
        })
      );

      return enhancedCommits;
    } catch (error) {
      this.errors.push({
        operation: "getPullRequestCommits",
        pullRequest: pullNumber,
        repository: `${owner}/${repo}`,
        error: error.message,
      });
      return [];
    }
  }

  async analyzeUserCommits() {
    console.log(chalk.blue.bold("🔸 Initialization"));

    // Display configuration
    console.log(`${chalk.cyan("Parameter")}            ${chalk.cyan("Value")}`);
    console.log("─".repeat(50));
    console.log(`👤 Search user       ${chalk.green(this.config.searchUser)}`);

    if (!this.config.ignoreDateRange && this.config.start && this.config.end) {
      console.log(
        `📅 Date range        ${chalk.green(
          this.config.start
        )} to ${chalk.green(this.config.end)}`
      );
    } else {
      console.log(`📅 Date range        ${chalk.yellow("All time")}`);
    }

    console.log(
      `🏢 Organization      ${chalk.green(
        this.config.org || "All organizations"
      )}`
    );
    console.log(
      `📂 Repositories      ${chalk.green(
        this.config.repo || "All repositories"
      )}`
    );
    console.log(
      `📄 Output format     ${chalk.green(this.config.format.toUpperCase())}`
    );
    console.log(`💾 Output directory  ${chalk.green(this.config.outputDir)}`);
    console.log(
      `📊 Include details   ${
        this.config.includeDetails
          ? chalk.green("Enabled")
          : chalk.gray("Disabled")
      }`
    );
    console.log(
      `🔍 Verbose mode      ${
        this.config.verbose ? chalk.green("Enabled") : chalk.gray("Disabled")
      }`
    );
    console.log(
      `🐛 Debug mode        ${
        this.config.debug ? chalk.green("Enabled") : chalk.gray("Disabled")
      }`
    );
    console.log(
      `📊 Total records limit ${
        this.config.totalRecords > 0
          ? chalk.green(this.config.totalRecords)
          : chalk.yellow("No limit")
      }`
    );
    console.log("");

    // Validate user
    console.log(chalk.blue.bold("🔸 User Validation"));
    await this.validateUser(this.config.searchUser);
    console.log("");

    // Search for direct commits using repository-based approach
    console.log(chalk.blue.bold("🔸 Repository-Based Commit Search"));
    const dateRange =
      !this.config.ignoreDateRange && this.config.start && this.config.end
        ? { start: this.config.start, end: this.config.end }
        : null;

    const directCommits = await CLIProgressHelper.withProgress(
      1,
      "Searching for direct commits",
      async (update) => {
        const commits = await this.searchUserRepositoryCommits(
          this.config.searchUser,
          dateRange
        );
        update(1);
        return commits;
      }
    );

    console.log(`📂 Found ${chalk.green(directCommits.length)} direct commits`);
    console.log("");

    // Search for pull requests with partitioning
    if (!this.cancelled && !this.checkTotalRecordsLimit()) {
      console.log(chalk.blue.bold("🔸 Pull Request Search"));
      const pullRequests = await CLIProgressHelper.withProgress(
        1,
        "Searching for pull requests",
        async (update) => {
          const prs = await this.searchPullRequestsWithPartitioning(
            this.config.searchUser,
            dateRange
          );
          update(1);
          return prs;
        }
      );

      console.log(`📂 Found ${chalk.green(pullRequests.length)} pull requests`);
      console.log("");

      // Analyze pull request commits
      if (
        pullRequests.length > 0 &&
        !this.cancelled &&
        !this.checkTotalRecordsLimit()
      ) {
        console.log(chalk.blue.bold("🔸 Pull Request Commit Analysis"));

        const prCommits = await CLIProgressHelper.withProgress(
          pullRequests.length,
          "Fetching PR commits",
          async (update) => {
            const allPrCommits = [];

            for (const pr of pullRequests) {
              if (this.cancelled || this.checkTotalRecordsLimit()) break;

              const [owner, repo] = pr.repository_url.split("/").slice(-2);
              const commits = await this.getPullRequestCommits(
                owner,
                repo,
                pr.number
              );
              allPrCommits.push(...commits);
              update(1);
              await this.delay(this.config.delay * 1000);
            }

            return allPrCommits;
          }
        );

        // Update direct commits that are actually part of PRs
        for (const prCommit of prCommits) {
          const directCommit = directCommits.find(
            (c) => c.sha === prCommit.sha
          );
          if (directCommit) {
            directCommit.type = "pull_request";
            directCommit.pullRequest = prCommit.pullRequest;
          }
        }

        // Add PR commits that weren't found in direct search
        for (const prCommit of prCommits) {
          if (!directCommits.find((c) => c.sha === prCommit.sha)) {
            directCommits.push(prCommit);
          }
        }
      }
    }

    this.commits = directCommits.map((v) => ({
      ...v,
      userId: this.config.searchUser,
    }));

    console.log("");
    console.log(chalk.blue.bold("📊 Processing Summary"));
    console.log("─".repeat(50));
    console.log(
      `✅ Total commits found    : ${chalk.green(this.commits.length)}`
    );
    console.log(
      `📝 Direct commits         : ${chalk.green(
        this.commits.filter((c) => c.type === "direct").length
      )}`
    );
    console.log(
      `🔀 Pull request commits   : ${chalk.green(
        this.commits.filter((c) => c.type === "pull_request").length
      )}`
    );
    console.log(
      `📂 Unique repositories    : ${chalk.green(
        new Set(this.commits.map((c) => c.repository)).size
      )}`
    );
    console.log(`❌ Errors encountered     : ${chalk.red(this.errors.length)}`);
    console.log(
      `📊 Records fetched/limit  : ${chalk.green(this.totalFetched)}${
        this.config.totalRecords > 0 ? `/${this.config.totalRecords}` : ""
      }`
    );
    console.log("─".repeat(50));
    console.log("");
  }

  groupCommitsByRepository() {
    const grouped = {};

    for (const commit of this.commits) {
      if (!grouped[commit.repository]) {
        grouped[commit.repository] = {
          direct: 0,
          pull_request: 0,
          commits: [],
          userId: this.config.searchUser,
          totalAdditions: 0,
          totalDeletions: 0,
          totalFiles: 0,
        };
      }

      grouped[commit.repository][commit.type]++;
      grouped[commit.repository].commits.push({
        ...commit,
        userId: this.config.searchUser,
      });

      if (commit.stats) {
        grouped[commit.repository].totalAdditions += commit.stats.additions;
        grouped[commit.repository].totalDeletions += commit.stats.deletions;
      }

      if (commit.files) {
        grouped[commit.repository].totalFiles += commit.files.length;
      }
    }

    return grouped;
  }

  groupCommitsByPullRequest() {
    const grouped = {};

    for (const commit of this.commits) {
      if (commit.type === "pull_request" && commit.pullRequest) {
        const key = `${commit.repository}#${commit.pullRequest}`;

        if (!grouped[key]) {
          grouped[key] = {
            repository: commit.repository,
            pullRequest: commit.pullRequest,
            userId: this.config.searchUser,
            commits: [],
            totalAdditions: 0,
            totalDeletions: 0,
            totalFiles: 0,
          };
        }

        grouped[key].commits.push({
          ...commit,
          userId: this.config.searchUser,
        });

        if (commit.stats) {
          grouped[key].totalAdditions += commit.stats.additions;
          grouped[key].totalDeletions += commit.stats.deletions;
        }

        if (commit.files) {
          grouped[key].totalFiles += commit.files.length;
        }
      }
    }

    return grouped;
  }

  async savePartialResults() {
    if (this.commits.length > 0) {
      console.log(chalk.yellow("💾 Saving partial results..."));
      await this.generateReport();
    }
  }

  async generateReport() {
    console.log(chalk.blue.bold("🔸 Report Generation"));

    // Ensure output directory exists
    await fs.mkdir(this.config.outputDir, { recursive: true });

    const filename =
      this.config.filename || `${this.config.searchUser}-commits`;
    const reportPath = path.join(
      this.config.outputDir,
      `${filename}.${this.config.format}`
    );

    const totalAdditions = this.commits.reduce(
      (sum, c) => sum + (c.stats?.additions || 0),
      0
    );
    const totalDeletions = this.commits.reduce(
      (sum, c) => sum + (c.stats?.deletions || 0),
      0
    );
    const totalFilesChanged = this.commits.reduce(
      (sum, c) => sum + (c.files?.length || 0),
      0
    );

    const report = {
      inputs: {
        searchUser: this.config.searchUser,
        org: this.config.org,
        repo: this.config.repo,
        start: this.config.start,
        end: this.config.end,
        ignoreDateRange: this.config.ignoreDateRange,
        totalRecords: this.config.totalRecords,
        includeDetails: this.config.includeDetails,
        generatedAt: new Date().toISOString(),
        cancelled: this.cancelled,
      },
      metaTags: this.config.metaTags,
      summary: {
        totalCommits: this.commits.length,
        directCommits: this.commits.filter((c) => c.type === "direct").length,
        pullRequestCommits: this.commits.filter(
          (c) => c.type === "pull_request"
        ).length,
        uniqueRepositories: new Set(this.commits.map((c) => c.repository)).size,
        uniquePullRequests: new Set(
          this.commits.filter((c) => c.pullRequest).map((c) => c.pullRequest)
        ).size,
        totalAdditions,
        totalDeletions,
        totalFilesChanged,
        totalRecordsFetched: this.totalFetched,
        dateRange: {
          earliest:
            this.commits.length > 0
              ? new Date(
                  Math.min(...this.commits.map((c) => new Date(c.date)))
                ).toISOString()
              : null,
          latest:
            this.commits.length > 0
              ? new Date(
                  Math.max(...this.commits.map((c) => new Date(c.date)))
                ).toISOString()
              : null,
        },
      },
      commits: this.commits,
      groupedByRepository: this.groupCommitsByRepository(),
      groupedByPullRequest: this.groupCommitsByPullRequest(),
      criteria: [
        "Commits authored by the specified user",
        "Commits within the specified date range (if provided)",
        "Both direct commits and pull request commits included",
        "Repository-based approach for reliable commit discovery",
        "Dual search strategy using both author: and user: qualifiers",
        "Partitioned queries for handling >1000 results",
        "Enhanced commit details including parents, stats, and files (if enabled)",
        `Total records limit enforced: ${
          this.config.totalRecords > 0 ? this.config.totalRecords : "No limit"
        }`,
      ],
      formula: [
        "Direct commits = commits found in user's repositories not associated with any pull request",
        "Pull request commits = commits that are part of a pull request authored by the user",
        "Total commits = direct commits + pull request commits (deduplicated by SHA)",
        "Repository filtering applied based on org and repo parameters if specified",
        "Date partitioning applied in weekly intervals to overcome 1000-result API limit",
        "Total additions = sum of all lines added across all commits",
        "Total deletions = sum of all lines deleted across all commits",
        "Total files changed = sum of all files modified across all commits",
        "Total records fetched = cumulative count across all API calls, respecting totalRecords limit",
      ],
    };

    if (this.config.format === "json") {
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    } else {
      // CSV format with enhanced fields
      const csvHeaders =
        "SHA,Message,Date,Repository,Type,PullRequest,Author,URL,TotalChanges,Additions,Deletions,FilesCount,ParentsCount\n";
      const csvRows = this.commits
        .map(
          (commit) =>
            `"${commit.sha}","${commit.message.replace(/"/g, '""')}","${
              commit.date
            }","${commit.repository}","${commit.type}","${
              commit.pullRequest || ""
            }","${commit.author}","${commit.url}","${
              commit.stats?.total || 0
            }","${commit.stats?.additions || 0}","${
              commit.stats?.deletions || 0
            }","${commit.files?.length || 0}","${commit.parents?.length || 0}"`
        )
        .join("\n");

      await fs.writeFile(reportPath, csvHeaders + csvRows);
    }

    console.log(`📄 Report saved: ${chalk.green(reportPath)}`);

    // Generate audit file if debug mode
    if (this.config.debug) {
      const auditPath = path.join(
        this.config.outputDir,
        `${filename}.audit.json`
      );
      const audit = {
        apiCalls: this.apiCalls,
        errors: this.errors,
        configuration: this.config,
        generatedAt: new Date().toISOString(),
        totalRecordsFetched: this.totalFetched,
        cancelled: this.cancelled,
      };

      await fs.writeFile(auditPath, JSON.stringify(audit, null, 2));
      console.log(`🔍 Audit file saved: ${chalk.green(auditPath)}`);
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

  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async run() {
    try {
      console.log(chalk.blue.bold("🚀 Starting GitHub commit analysis...\n"));

      await this.analyzeUserCommits();
      await this.generateReport();

      console.log("");
      console.log(chalk.blue.bold("📊 GitHub API Usage Summary:"));
      console.log("─".repeat(60));
      console.log(`Total API calls: ${chalk.green(this.apiCalls.length)}`);
      console.log(
        `API paths used: ${chalk.green(
          [
            ...new Set(
              this.apiCalls.map((call) => {
                try {
                  return new URL(
                    `https://api.github.com${call.url.split(" ")[1]}`
                  ).pathname;
                } catch {
                  return call.url.split(" ")[1] || call.url;
                }
              })
            ),
          ].join(", ")
        )}`
      );

      await this.showRateLimit();

      console.log("");
      console.log(chalk.green.bold("✅ Analysis completed successfully!"));

      console.log("");
      console.log(chalk.blue.bold("📊 Final Report Summary"));
      console.log("─".repeat(60));
      console.log(`📊 User          : ${chalk.green(this.config.searchUser)}`);
      console.log(
        `📊 Date Range     : ${chalk.green(
          this.config.start || "N/A"
        )}/${chalk.green(this.config.end || "N/A")}`
      );
      console.log(
        `📊 Total Commits          : ${chalk.green(this.commits.length)}`
      );
      console.log(
        `📝 Direct Commits         : ${chalk.green(
          this.commits.filter((c) => c.type === "direct").length
        )}`
      );
      console.log(
        `🔀 Pull Request Commits   : ${chalk.green(
          this.commits.filter((c) => c.type === "pull_request").length
        )}`
      );
      console.log(
        `📂 Repositories Analyzed  : ${chalk.green(
          new Set(this.commits.map((c) => c.repository)).size
        )}`
      );

      const totalAdditions = this.commits.reduce(
        (sum, c) => sum + (c.stats?.additions || 0),
        0
      );
      const totalDeletions = this.commits.reduce(
        (sum, c) => sum + (c.stats?.deletions || 0),
        0
      );
      const totalFilesChanged = this.commits.reduce(
        (sum, c) => sum + (c.files?.length || 0),
        0
      );

      console.log(`➕ Total Additions        : ${chalk.green(totalAdditions)}`);
      console.log(`➖ Total Deletions        : ${chalk.green(totalDeletions)}`);
      console.log(
        `📝 Files Changed          : ${chalk.green(totalFilesChanged)}`
      );
      console.log(
        `📊 Records Fetched        : ${chalk.green(this.totalFetched)}${
          this.config.totalRecords > 0 ? `/${this.config.totalRecords}` : ""
        }`
      );
      console.log(
        `📄 Report Location        : ${chalk.green(
          path.join(
            this.config.outputDir,
            `${this.config.filename || this.config.searchUser + "-commits"}.${
              this.config.format
            }`
          )
        )}`
      );
      console.log("─".repeat(60));
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
        console.error(chalk.gray(error.stack));
      }
      process.exit(1);
    }
  }
}

function parseMetaTags(tags = []) {
  const metaTags = {};
  tags.forEach((tag) => {
    const [key, value] = tag.split("=");
    if (key && value) {
      metaTags[key] = value;
    }
  });
  return metaTags;
}

async function main() {
  const program = new Command();

  program
    .name("all_user_commit")
    .description(
      "Analyze all commits made by a GitHub user within a date range"
    )
    .option("--org <org>", "GitHub organization")
    .option(
      "--repo <repo>",
      "Comma-separated list of specific repository names"
    )
    .option(
      "--searchUser <userIdentifier>",
      "GitHub username to analyze (required)"
    )
    .option(
      "--meta-tags <key=value>",
      "Metadata tags (can be repeated)",
      (value, previous) => {
        return previous.concat([value]);
      },
      []
    )
    .option("--format <format>", "Output format (json|csv)", "json")
    .option("--outputDir <directory>", "Directory to save files", "./output")
    .option("--filename <filename>", "Base name for output files")
    .option("--ignoreDateRange", "Ignore date range and search all time", false)
    .option("--start <date>", "Start date (YYYY-MM-DD)")
    .option("--end <date>", "End date (YYYY-MM-DD)")
    .option("--token <token>", "GitHub Personal Access Token")
    .option("--verbose", "Enable verbose logging", false)
    .option("--debug", "Enable debug logging", false)
    .option("--loadData <filepath>", "Path to JSON file to load at runtime")
    .option(
      "--totalRecords <number>",
      "Maximum total records to fetch across all sources (0 = no limit)",
      "0"
    )
    .option(
      "--partitionBy <qualifier>",
      "Primary qualifier for partitioning",
      "created"
    )
    .option("--delay <seconds>", "Delay between API requests in seconds", "6")
    .option(
      "--includeDetails",
      "Include detailed commit information (parents, stats, files)",
      true
    );

  program.parse();
  const options = program.opts();

  // Validate required arguments
  if (!options.searchUser) {
    console.error(chalk.red("❌ Error: --searchUser is required"));
    process.exit(1);
  }

  // Validate GitHub token
  if (!options.token && !process.env.GITHUB_TOKEN) {
    console.error(
      chalk.red(
        "❌ Error: GitHub token is required. Set GITHUB_TOKEN environment variable or use --token"
      )
    );
    process.exit(1);
  }

  // Parse meta tags
  options.metaTags = parseMetaTags(options.metaTags);

  // Set default dates if not ignoring date range and not provided
  if (!options.ignoreDateRange) {
    if (!options.start) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      options.start = thirtyDaysAgo.toISOString().split("T")[0];
    }

    if (!options.end) {
      options.end = new Date().toISOString().split("T")[0];
    }

    // Validate date format only if dates are provided
    if (options.start || options.end) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (options.start && !dateRegex.test(options.start)) {
        console.error(chalk.red("❌ Start date must be in YYYY-MM-DD format"));
        process.exit(1);
      }
      if (options.end && !dateRegex.test(options.end)) {
        console.error(chalk.red("❌ End date must be in YYYY-MM-DD format"));
        process.exit(1);
      }

      // Validate date logic
      if (
        options.start &&
        options.end &&
        new Date(options.start) > new Date(options.end)
      ) {
        console.error(chalk.red("❌ Start date must be before end date"));
        process.exit(1);
      }

      // Validate dates are not in the future
      const today = new Date();
      today.setHours(23, 59, 59, 999); // End of today

      if (options.start && new Date(options.start) > today) {
        console.error(chalk.red("❌ Start date cannot be in the future"));
        process.exit(1);
      }
      if (options.end && new Date(options.end) > today) {
        console.error(chalk.red("❌ End date cannot be in the future"));
        process.exit(1);
      }
    }
  }

  // Convert string numbers to integers
  if (options.totalRecords) {
    options.totalRecords = parseInt(options.totalRecords, 10);
  }
  if (options.delay) {
    options.delay = parseInt(options.delay, 10);
  }

  const analyzer = new AllUserCommit(options);
  await analyzer.run();
}

// Run the CLI if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    writeFileSync(
      path.join(
        this.config.outputDir,
        `dashboard-${this.config.filename}.failed.json`
      ),
      JSON.stringify({
        errors: [error.message],
        inputs: {
          ...this.config,
          userProfile: `https://${process.env.GITHUB_HOSTNAME}/${this.config.searchUser}?tab=overview`,
        },
      })
    );
    console.error(chalk.red(`❌ Unexpected error: ${error.message}`));
    process.exit(1);
  });
}

export { AllUserCommit };
