```sh
node ./generate.mjs --searchUser username --debug --verbose

# Verbose logging (logs to github.log)

node ./generate.mjs --searchUser username --verbose

# Debug mode with audit files

node ./generate.mjs --searchUser username --debug

# Limited API calls for testing

node ./generate.mjs --searchUser username --rateLimit 50

# Basic usage - analyze last 30 days

node ./generate.mjs --searchUser username

# Specify date range

node ./generate.mjs --searchUser username --start 2024-01-01 --end 2024-01-31

# With organization filter

node ./generate.mjs --searchUser username --org your-org-name

# Verbose output

node ./generate.mjs --searchUser username --verbose

# Run only specific modules

node ./generate.mjs --searchUser username --modules "prThroughput,codeChurn"

node ./generate.mjs --searchUser username --format json
node ./generate.mjs --searchUser username --format csv
node ./generate.mjs --searchUser username --format html

# SQLite

node ./generate.mjs --searchUser username --format database --databaseUrl "sqlite:./reports.db"

# PostgreSQL

node ./generate.mjs --searchUser username --format database --databaseUrl "postgres://user:pass@localhost:5432/reports"


node main.mjs \
 --searchUser username \
 --org myorg \
 --repo repo1,repo2 \
 --start 2024-01-01 \
 --end 2024-03-31 \
 --format json \
 --outputDir ./reports \
 --filename q1-analysis \
 --meta-tags project=analysis \
 --meta-tags quarter=Q1 \
 --verbose \
 --debug


node ./generate.mjs \
 --searchUser username \
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

pip install -r requirements.txt

```sh
python main.py \
  --directory output \
  --outputDir ./reports \
  --filename monthly_team_analysis \
  --ignore-pattern "*audit.json,*temp*.json" \
  --debug \
  --verbose

python main.py --directory ./data --no-export-json
python main.py --directory ./data --json-indent 4
python main.py --directory ./data --verbose --export-json

python main.py --directory output --outputDir ./reports --filename monthly_team_analysis --ignore-pattern "*audit.json,*temp*.json" --debug --verbose
```
