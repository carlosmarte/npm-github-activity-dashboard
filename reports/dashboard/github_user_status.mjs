import { Command } from "commander";
import { Octokit } from "octokit";
import { API_Rate_Limiter } from "@thinkeloquent/npm-api-rate-limiter";
import { ProgressBar, CLIProgressHelper } from "@thinkeloquent/cli-progressor";
import { z } from "zod";
import chalk from "chalk";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";

dotenv.config();

/*
 * Project Name: github_user_status
 * Purpose: Check the status (Active, Suspended, or Not Found) of GitHub users via the GitHub API
 * Description: This tool validates GitHub user accounts by making API calls to determine if users are active, suspended, or not found. It supports batch processing and provides comprehensive reporting with rate limiting and error handling.
 *
 * Requirements Summary:
 * - Check GitHub user status using GET /users/{username} endpoint
 * - Support batch processing of multiple usernames
 * - Rate limit awareness and management with separate limiters for core and search APIs
 * - Verbose and debug logging capabilities
 * - Differentiate between suspended and not found users using search API
 * - Generate structured JSON/CSV reports with comprehensive metadata
 * - Handle API errors gracefully with proper error reporting
 *
 * JSON Report Structure:
 * {
 *   "inputs": { "searchUser": "username1,username2", "format": "json", ... },
 *   "metaTags": { "customKey": "customValue" },
 *   "summary": { "totalUsers": 2, "activeUsers": 1, "suspendedUsers": 0, "notFoundUsers": 1 },
 *   "users": [
 *     {
 *       "username": "activeuser",
 *       "status": "Active",
 *       "details": { "id": 123, "name": "Active User", "created_at": "2020-01-01T00:00:00Z" }
 *     },
 *     {
 *       "username": "notfounduser",
 *       "status": "Not Found / Suspended"
 *     }
 *   ],
 *   "criteria": ["HTTP 200 = Active", "HTTP 404 + Search found = Suspended", "HTTP 404 + Search not found = Not Found"],
 *   "formula": ["status = response.status === 200 ? 'Active' : searchAPI(username)"]
 * }
 *
 * Potential Insights:
 * - User account validation for team management
 * - Batch verification of user account statuses
 * - Detection of suspended or deleted accounts
 * - User profile data aggregation and analysis
 */

// Environment variables
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_BASE_API_URL =
  process.env.GITHUB_BASE_API_URL || "https://api.github.com";

// Zod schemas for validation
const UserDetailsSchema = z.object({
  id: z.number(),
  login: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  public_repos: z.number(),
  followers: z.number(),
  following: z.number(),
  bio: z.string().nullable(),
  location: z.string().nullable(),
  company: z.string().nullable(),
  blog: z.string().nullable(),
  twitter_username: z.string().nullable(),
  suspended_at: z.string().nullable().optional(),
});

const UserStatusSchema = z.object({
  username: z.string(),
  status: z.enum(["Active", "Suspended", "Not Found / Suspended", "Error"]),
  details: z
    .object({
      id: z.number().optional(),
      name: z.string().nullable().optional(),
      created_at: z.string().optional(),
      updated_at: z.string().optional(),
      public_repos: z.number().optional(),
      followers: z.number().optional(),
      following: z.number().optional(),
      bio: z.string().nullable().optional(),
      location: z.string().nullable().optional(),
      company: z.string().nullable().optional(),
      blog: z.string().nullable().optional(),
      twitter_username: z.string().nullable().optional(),
    })
    .optional(),
  error: z.string().optional(),
});

const ConfigSchema = z.object({
  searchUser: z.string().min(1),
  token: z.string().min(1),
  format: z.enum(["json", "csv"]),
  outputDir: z.string(),
  filename: z.string(),
  metaTags: z.record(z.string()),
  verbose: z.boolean(),
  debug: z.boolean(),
  delay: z.number().min(0),
  loadData: z.string().optional(),
  totalRecords: z.number().min(0),
  ignoreDateRange: z.boolean(),
  start: z.string().optional(),
  end: z.string().optional(),
  org: z.string().optional(),
  repo: z.string().optional(),
});

class GitHubUserStatus {
  constructor(options = {}) {
    this.config = this.validateAndSetupConfig(options);
    this.initializeGitHubClient();
    this.initializeRateLimiters();
    this.auditData = {
      requests: [],
      responses: [],
      errors: [],
      apiPaths: new Set(),
    };
    this.loadData = null;
    this.totalApiCalls = 0;
  }

  validateAndSetupConfig(options) {
    const config = {
      ...options,
      token: options.token || GITHUB_TOKEN,
      format: options.format || "json",
      outputDir: options.outputDir || "./output",
      filename: options.filename || "github-user-status",
      metaTags: options.metaTags || {},
      verbose: options.verbose || false,
      debug: options.debug || false,
      delay: options.delay || 2,
      totalRecords: options.totalRecords || 0,
      ignoreDateRange: options.ignoreDateRange || true,
    };

    try {
      return ConfigSchema.parse(config);
    } catch (error) {
      throw new Error(`Configuration validation failed: ${error.message}`);
    }
  }

  initializeGitHubClient() {
    this.octokit = new Octokit({
      auth: this.config.token,
      baseUrl: GITHUB_BASE_API_URL,
    });
  }

  initializeRateLimiters() {
    this.coreLimiter = new API_Rate_Limiter("github-core", {
      getRateLimitStatus: async () => {
        const { data } = await this.octokit.rest.rateLimit.get();
        return data.resources.core;
      },
    });

    this.searchLimiter = new API_Rate_Limiter("github-search", {
      getRateLimitStatus: async () => {
        const { data } = await this.octokit.rest.rateLimit.get();
        return data.resources.search;
      },
    });
  }

  async loadExternalData() {
    if (this.config.loadData) {
      try {
        const data = await fs.readFile(this.config.loadData, "utf8");
        this.loadData = JSON.parse(data);
        if (this.config.verbose) {
          console.log(
            chalk.blue(`📂 Loaded external data from ${this.config.loadData}`)
          );
        }
      } catch (error) {
        console.error(
          chalk.red(`❌ Failed to load external data: ${error.message}`)
        );
      }
    }
  }

  async makeRequest(endpoint, options = {}, limiter = this.coreLimiter) {
    return limiter.schedule(async () => {
      const startTime = Date.now();

      try {
        if (this.config.verbose) {
          console.log(chalk.gray(`🔗 Making request to: ${endpoint}`));
        }

        const response = await this.octokit.request(endpoint, options);
        this.totalApiCalls++;

        // Track API paths for summary
        const apiPath = endpoint.split(" ")[1] || endpoint;
        this.auditData.apiPaths.add(apiPath);

        if (this.config.debug) {
          const requestData = {
            endpoint,
            options,
            timestamp: new Date().toISOString(),
            duration: Date.now() - startTime,
            statusCode: response.status,
          };

          this.auditData.requests.push(requestData);
          this.auditData.responses.push({
            endpoint,
            data: response.data,
            headers: response.headers,
            timestamp: new Date().toISOString(),
          });

          // Log to file in debug mode
          const logEntry = `[${new Date().toISOString()}] ${endpoint} - ${
            response.status
          } - ${Date.now() - startTime}ms\n`;
          await fs.appendFile("github.log", logEntry).catch(() => {});
        }

        return response;
      } catch (error) {
        this.totalApiCalls++;

        if (this.config.debug) {
          this.auditData.errors.push({
            endpoint,
            options,
            error: error.message,
            status: error.status,
            timestamp: new Date().toISOString(),
          });

          // Log error to file
          const logEntry = `[${new Date().toISOString()}] ERROR ${endpoint} - ${
            error.status
          } - ${error.message}\n`;
          await fs.appendFile("github.log", logEntry).catch(() => {});
        }

        throw error;
      }
    });
  }

  async validateUser(username) {
    try {
      const response = await this.makeRequest("GET /users/{username}", {
        username,
      });

      if (this.config.verbose) {
        console.log(chalk.green(`✅ User '${username}' is active`));
      }

      // Validate the response with Zod
      const userDetails = UserDetailsSchema.parse(response.data);

      return {
        username,
        status: "Active",
        details: {
          id: userDetails.id,
          name: userDetails.name,
          created_at: userDetails.created_at,
          updated_at: userDetails.updated_at,
          public_repos: userDetails.public_repos,
          followers: userDetails.followers,
          following: userDetails.following,
          bio: userDetails.bio,
          location: userDetails.location,
          company: userDetails.company,
          blog: userDetails.blog,
          twitter_username: userDetails.twitter_username,
        },
      };
    } catch (error) {
      if (error.status === 404) {
        // Try to differentiate between suspended and not found
        const searchResult = await this.searchForUser(username);

        if (searchResult.found) {
          return {
            username,
            status: "Suspended",
            details: searchResult.details,
          };
        } else {
          return {
            username,
            status: "Not Found / Suspended",
          };
        }
      }

      throw error;
    }
  }

  async searchForUser(username) {
    try {
      const response = await this.makeRequest(
        "GET /search/users",
        { q: `user:${username}` },
        this.searchLimiter
      );

      if (response.data.total_count > 0) {
        const user = response.data.items[0];

        if (this.config.verbose) {
          console.log(
            chalk.yellow(
              `⚠️ User '${username}' found in search but not accessible (likely suspended)`
            )
          );
        }

        return {
          found: true,
          details: {
            id: user.id,
            name: user.login,
            created_at: null, // Not available in search results
          },
        };
      }

      if (this.config.verbose) {
        console.log(chalk.red(`❌ User '${username}' not found in search`));
      }

      return { found: false };
    } catch (error) {
      if (this.config.verbose) {
        console.log(
          chalk.yellow(
            `⚠️ Search API failed for user '${username}': ${error.message}`
          )
        );
      }
      return { found: false };
    }
  }

  async checkRateLimit() {
    try {
      const { data } = await this.octokit.rest.rateLimit.get();
      const { resources } = data;

      if (this.config.verbose) {
        console.log(
          chalk.blue(
            `📊 Rate limit: ${resources.core.remaining}/${resources.core.limit} core, ${resources.search.remaining}/${resources.search.limit} search`
          )
        );
      }

      if (resources.core.remaining < 10) {
        console.log(
          chalk.yellow(
            `⚠️ Warning: Core API rate limit is low (${resources.core.remaining} remaining)`
          )
        );
      }

      if (resources.search.remaining < 5) {
        console.log(
          chalk.yellow(
            `⚠️ Warning: Search API rate limit is low (${resources.search.remaining} remaining)`
          )
        );
      }

      return resources;
    } catch (error) {
      console.error(
        chalk.red(`❌ Failed to check rate limit: ${error.message}`)
      );
      return null;
    }
  }

  async processUsers(usernames) {
    const results = [];

    // Apply total records limit if specified
    const usersToProcess =
      this.config.totalRecords > 0
        ? usernames.slice(0, this.config.totalRecords)
        : usernames;

    await CLIProgressHelper.withProgress(
      usersToProcess.length,
      "Checking user status",
      async (update) => {
        for (const username of usersToProcess) {
          try {
            const userStatus = await this.validateUser(username);

            // Validate the result with Zod
            const validatedStatus = UserStatusSchema.parse(userStatus);
            results.push(validatedStatus);

            if (this.config.verbose) {
              console.log(
                chalk.green(
                  `✅ Processed user: ${username} (${userStatus.status})`
                )
              );
            }
          } catch (error) {
            const errorResult = {
              username,
              status: "Error",
              error: error.message,
            };

            results.push(errorResult);

            console.error(
              chalk.red(
                `❌ Failed to process user ${username}: ${error.message}`
              )
            );
          }

          update(1);

          // Add delay between requests
          if (this.config.delay > 0) {
            await new Promise((resolve) =>
              setTimeout(resolve, this.config.delay * 1000)
            );
          }
        }
      }
    );

    return results;
  }

  generateReport(users) {
    const summary = {
      totalUsers: users.length,
      activeUsers: users.filter((u) => u.status === "Active").length,
      suspendedUsers: users.filter((u) => u.status === "Suspended").length,
      notFoundUsers: users.filter((u) => u.status === "Not Found / Suspended")
        .length,
      errorUsers: users.filter((u) => u.status === "Error").length,
    };

    const report = {
      inputs: {
        searchUser: this.config.searchUser,
        format: this.config.format,
        outputDir: this.config.outputDir,
        filename: this.config.filename,
        verbose: this.config.verbose,
        debug: this.config.debug,
        delay: this.config.delay,
        totalRecords: this.config.totalRecords,
        ignoreDateRange: this.config.ignoreDateRange,
      },
      metaTags: this.config.metaTags,
      summary,
      users,
      criteria: [
        "HTTP 200 response from /users/{username} = Active user",
        "HTTP 404 response + user found in search = Suspended user",
        "HTTP 404 response + user not found in search = Not Found / Suspended user",
        "Other HTTP errors = Error status",
      ],
      formula: [
        'status = response.status === 200 ? "Active" : await searchForUser(username)',
        'searchForUser = searchResult.found ? "Suspended" : "Not Found / Suspended"',
        'errorHandling = catchError ? "Error" : status',
      ],
      generatedAt: new Date().toISOString(),
    };

    if (this.loadData) {
      report.loadedData = this.loadData;
    }

    return report;
  }

  async saveReport(report) {
    await fs.mkdir(this.config.outputDir, { recursive: true });

    const filename = `${this.config.filename}.${this.config.format}`;
    const filepath = path.join(this.config.outputDir, filename);

    let content;
    if (this.config.format === "json") {
      content = JSON.stringify(report, null, 2);
    } else if (this.config.format === "csv") {
      content = this.convertToCSV(report);
    }

    await fs.writeFile(filepath, content);
    console.log(chalk.green(`📄 Report saved: ${filepath}`));

    // Save audit file if debug mode is enabled
    if (this.config.debug) {
      const auditFilepath = path.join(
        this.config.outputDir,
        `${this.config.filename}.audit.json`
      );
      await fs.writeFile(
        auditFilepath,
        JSON.stringify(this.auditData, null, 2)
      );
      console.log(chalk.blue(`🔍 Audit file saved: ${auditFilepath}`));
    }
  }

  convertToCSV(report) {
    const headers = [
      "username",
      "status",
      "id",
      "name",
      "created_at",
      "updated_at",
      "public_repos",
      "followers",
      "following",
      "bio",
      "location",
      "company",
      "blog",
      "twitter_username",
      "error",
    ];

    const rows = [headers.join(",")];

    for (const user of report.users) {
      const row = [
        user.username,
        user.status,
        user.details?.id || "",
        user.details?.name || "",
        user.details?.created_at || "",
        user.details?.updated_at || "",
        user.details?.public_repos || "",
        user.details?.followers || "",
        user.details?.following || "",
        user.details?.bio || "",
        user.details?.location || "",
        user.details?.company || "",
        user.details?.blog || "",
        user.details?.twitter_username || "",
        user.error || "",
      ];

      rows.push(
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
      );
    }

    return rows.join("\n");
  }

  async showRateLimit() {
    try {
      const { data } = await this.octokit.rest.rateLimit.get();
      const { resources } = data;

      console.log(chalk.blue.bold("\n📊 GitHub API Rate Limit Status:"));
      console.log(
        `   Core API - Limit: ${chalk.green.bold(
          resources.core.limit
        )}, Remaining: ${chalk.green.bold(
          resources.core.remaining
        )}, Used: ${chalk.yellow.bold(resources.core.used)}`
      );
      console.log(
        `   Search API - Limit: ${chalk.green.bold(
          resources.search.limit
        )}, Remaining: ${chalk.green.bold(
          resources.search.remaining
        )}, Used: ${chalk.yellow.bold(resources.search.used)}`
      );
      console.log(
        `   Resets at: ${chalk.gray(
          new Date(resources.core.reset * 1000).toLocaleString()
        )}`
      );

      if (resources.core.remaining < 10) {
        console.log(
          chalk.red.bold("   ⚠️  Warning: Core API rate limit is low!")
        );
      }

      if (resources.search.remaining < 5) {
        console.log(
          chalk.red.bold("   ⚠️  Warning: Search API rate limit is low!")
        );
      }
    } catch (error) {
      console.error(chalk.red("❌ Failed to fetch rate limit information"));
    }
  }

  displayConfiguration() {
    console.log(chalk.blue.bold("🔸 Initialization"));
    console.log(chalk.green("🔧 GitHubUserStatus initialized"));

    console.log(chalk.blue("\n📋 Configuration:"));
    console.log(`Parameter            Value`);
    console.log(`──────────────────── ──────────────────────────────`);
    console.log(`👤 Search user       ${this.config.searchUser}`);
    console.log(`📄 Output format     ${this.config.format}`);
    console.log(`💾 Output directory  ${this.config.outputDir}`);
    console.log(`📁 Filename          ${this.config.filename}`);
    console.log(
      `🔍 Verbose mode      ${this.config.verbose ? "Enabled" : "Disabled"}`
    );
    console.log(
      `🐛 Debug mode        ${this.config.debug ? "Enabled" : "Disabled"}`
    );
    console.log(`⏱️ Delay             ${this.config.delay}s`);
    console.log(
      `📊 Total records     ${this.config.totalRecords || "Unlimited"}`
    );
    console.log(
      `🏷️ Meta tags         ${Object.keys(this.config.metaTags).length} tags`
    );
  }

  async run() {
    try {
      this.displayConfiguration();

      // Load external data if specified
      await this.loadExternalData();

      // Check rate limit before starting
      await this.checkRateLimit();

      console.log(
        chalk.blue.bold("\n🚀 Starting GitHub user status analysis...")
      );

      // Process users (support batch processing)
      const usernames = this.config.searchUser
        .split(",")
        .map((u) => u.trim())
        .filter((u) => u);

      if (usernames.length === 0) {
        throw new Error("No valid usernames provided");
      }

      const users = await this.processUsers(usernames);

      // Generate report
      console.log(chalk.blue.bold("\n🔸 Report Generation"));
      const report = this.generateReport(users);

      // Save report
      await this.saveReport(report);

      // Display processing summary
      console.log(chalk.blue.bold("\n📊 Processing Summary"));
      console.log("──────────────────────────────────────────────────");
      console.log(
        `✅ Successfully processed  : ${
          report.summary.totalUsers - report.summary.errorUsers
        } users`
      );
      console.log(
        `❌ Failed to process       : ${report.summary.errorUsers} users`
      );
      console.log(`👤 Active users           : ${report.summary.activeUsers}`);
      console.log(
        `⚠️ Suspended users        : ${report.summary.suspendedUsers}`
      );
      console.log(
        `❓ Not found users        : ${report.summary.notFoundUsers}`
      );
      console.log(
        `📈 Success rate           : ${
          report.summary.totalUsers > 0
            ? (
                ((report.summary.totalUsers - report.summary.errorUsers) /
                  report.summary.totalUsers) *
                100
              ).toFixed(1)
            : 0
        }%`
      );
      console.log("──────────────────────────────────────────────────");

      // Show GitHub API usage summary
      console.log(chalk.blue.bold("\n📊 GitHub API Usage Summary:"));
      console.log(
        "────────────────────────────────────────────────────────────"
      );
      console.log(`Total API calls: ${this.totalApiCalls}`);
      console.log(
        `API paths used: ${Array.from(this.auditData.apiPaths).join(", ")}`
      );

      // Show final rate limit status
      await this.showRateLimit();

      console.log(chalk.green.bold("\n✅ Analysis completed successfully!"));

      // Display final report summary
      console.log(chalk.blue.bold("\n📊 Final Report Summary"));
      console.log(
        "────────────────────────────────────────────────────────────"
      );
      console.log(`👤 Total Users Checked    : ${report.summary.totalUsers}`);
      console.log(`✅ Active Users           : ${report.summary.activeUsers}`);
      console.log(
        `⚠️ Suspended Users        : ${report.summary.suspendedUsers}`
      );
      console.log(
        `❓ Not Found Users        : ${report.summary.notFoundUsers}`
      );
      console.log(`❌ Error Users            : ${report.summary.errorUsers}`);
      console.log(
        `📄 Report Location        : ${this.config.outputDir}/${this.config.filename}.${this.config.format}`
      );
      console.log(
        "────────────────────────────────────────────────────────────"
      );
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
        console.error(chalk.red("Stack trace:"), error.stack);
      }

      const errorOutput = {
        error: "GitHub user status analysis failed",
        message: error.message,
        timestamp: new Date().toISOString(),
      };

      console.error(JSON.stringify(errorOutput));
      process.exit(1);
    }
  }
}

// CLI setup
const program = new Command();

program
  .name("github-user-status")
  .description(
    "Check the status of GitHub users (Active, Suspended, or Not Found)"
  )
  .version("1.0.0");

program
  .requiredOption(
    "--searchUser <users>",
    "GitHub username(s) to check (comma-separated)"
  )
  .option("--org <org>", "GitHub organization (optional)")
  .option(
    "--repo <repo>",
    "Comma-separated list of repository names (optional)"
  )
  .option("--meta-tags <tags...>", "Meta tags in KEY=VALUE format", [])
  .option("--format <format>", "Output format (json|csv)", "json")
  .option("--outputDir <directory>", "Output directory", "./output")
  .option("--filename <filename>", "Output filename", "github-user-status")
  .option("--ignoreDateRange", "Ignore date range filtering", false)
  .option("--start <date>", "Start date for analysis (YYYY-MM-DD)")
  .option("--end <date>", "End date for analysis (YYYY-MM-DD)")
  .option("--token <token>", "GitHub Personal Access Token")
  .option("--verbose", "Enable verbose logging", false)
  .option("--debug", "Enable debug logging", false)
  .option("--loadData <filepath>", "Load external data from JSON file")
  .option("--totalRecords <number>", "Maximum number of users to process", "0")
  .option("--delay <seconds>", "Delay between requests in seconds", "2")
  .action(async (options) => {
    try {
      // Parse meta tags
      const metaTags = {};
      if (options.metaTags) {
        options.metaTags.forEach((tag) => {
          const [key, value] = tag.split("=");
          if (key && value) {
            metaTags[key] = value;
          }
        });
      }

      // Create configuration
      const config = {
        ...options,
        metaTags,
        delay: parseInt(options.delay) || 2,
        totalRecords: parseInt(options.totalRecords) || 0,
      };

      // Run the analyzer
      const analyzer = new GitHubUserStatus(config);
      await analyzer.run();
    } catch (error) {
      console.error(chalk.red(`❌ Error: ${error.message}`));
      process.exit(1);
    }
  });

// Handle the case when no arguments are provided
if (process.argv.length === 2) {
  program.help();
}

program.parse();

// Export for testing
export { GitHubUserStatus };
