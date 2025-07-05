```sh
node ./generate.mjs --searchUser octocat --debug --verbose

# Verbose logging (logs to github.log)

node ./generate.mjs --searchUser octocat --verbose

# Debug mode with audit files

node ./generate.mjs --searchUser octocat --debug

# Limited API calls for testing

node ./generate.mjs --searchUser octocat --rateLimit 50

# Basic usage - analyze last 30 days

node ./generate.mjs --searchUser your-github-username

# Specify date range

node ./generate.mjs --searchUser your-github-username --start 2024-01-01 --end 2024-01-31

# With organization filter

node ./generate.mjs --searchUser your-github-username --org your-org-name

# Verbose output

node ./generate.mjs --searchUser your-github-username --verbose

# Run only specific modules

node ./generate.mjs --searchUser username --modules "prThroughput,codeChurn"

node ./generate.mjs --searchUser username --format json
node ./generate.mjs --searchUser username --format csv
node ./generate.mjs --searchUser username --format html

# SQLite

node ./generate.mjs --searchUser username --format database --databaseUrl "sqlite:./reports.db"

# PostgreSQL

node ./generate.mjs --searchUser username --format database --databaseUrl "postgres://user:pass@localhost:5432/reports"

node ./generate.mjs \
 --searchUser john-developer \
 --start 2024-01-01 \
 --end 2024-03-31 \
 --format html \
 --filename "john-q1-review" \
 --verbose

node ./generate.mjs \
 --searchUser developer \
 --debug \
 --verbose \
 --rateLimit 500 \
 --format json

```
