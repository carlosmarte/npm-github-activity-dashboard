#!/bin/bash

# Define start as 30 days ago
start=$(date -v -30d +%F 2>/dev/null || date -d "30 days ago" +%F)

# Define end as today
end=$(date +%F)

# List of GitHub users
# users=("user1" "user2" "user3")
users=("carlosmarte")

# Loop through each user and execute the Node script
for username in "${users[@]}"; do
  echo "🔄 Running for user: $username"
  node ./developer_insights.mjs \
    --searchUser "$username" \
    --debug \
    --verbose \
    --format json \
    --outputDir "./output/developer_insights" \
    --filename "dashboard-$username.json" \
    --rateLimit 0 \
    --ignoreDateRange
  echo "✅ Finished for user: $username"
  echo "------------------------------"
done