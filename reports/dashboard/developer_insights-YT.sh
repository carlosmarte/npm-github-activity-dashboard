#!/bin/bash

# Prompt the user for how many years back to go
read -p "📅 How many years back? (e.g., 0 for this year, 1 for last year): " years_back

# Validate input
if ! [[ "$years_back" =~ ^[0-9]+$ ]]; then
  echo "❌ Invalid input. Please enter a non-negative number."
  exit 1
fi

# Detect OS and compute target year
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  target_year=$(date -v -${years_back}y +%Y)
else
  # Linux / others
  target_year=$(date -d "$years_back year ago" +%Y)
fi

# Ensure yyyy-mm-dd format
start="${target_year}-01-01"
end="${target_year}-12-31"

echo "📆 Date range selected: $start to $end"

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
    --outputDir "./output/developer_insights" \
    --filename "dashboard-$username.json" \
    --rateLimit 0 \
    --start "$start" \
    --end "$end"
  echo "✅ Finished for user: $username"
  echo "------------------------------"
done