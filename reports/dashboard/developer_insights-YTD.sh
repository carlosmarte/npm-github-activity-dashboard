#!/bin/bash

# Define start as Jan 1 of the current year
start="$(date +%Y)-01-01"

# Define end as today
end="$(date +%F)"

# List of GitHub users
# users=("user1" "user2" "user3")
users=("octocat")

# Loop through each user and execute the Node script
for username in "${users[@]}"; do
  echo "🔄 Running for user: $username"
  node ./developer_insights.mjs \
    --searchUser "$username" \
    --debug \
    --verbose \
    --format json \
    --outputDir "./output/developer_insights_YTD" \
    --filename "dashboard-$username.json" \
    --rateLimit 0 \
    --start "$start" \
    --end "$end"
  echo "✅ Finished for user: $username"
  echo "------------------------------"
done