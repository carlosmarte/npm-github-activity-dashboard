#!/usr/bin/env python3
"""
Developer Insights Excel Report Generator

A multi-agent AI system for transforming developer activity JSON reports 
into actionable Excel insights highlighting team inefficiencies.

Architecture:
- Orchestrator: CLI interface and workflow coordination
- Ingestor: JSON file discovery and parsing  
- Nexus: Data transformation and aggregation
- Viz: Excel generation with styling and visualization
"""

import argparse
import glob
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, field
import re
from pprint import pprint

import pandas as pd
import xlsxwriter
from xlsxwriter.utility import xl_col_to_name


@dataclass
class ProcessingResult:
    """Results from file processing operations"""
    files_processed: int = 0
    files_skipped: int = 0
    files_failed: int = 0
    error_messages: List[str] = field(default_factory=list)
    total_records: int = 0


class AllUserCommit:
    """
    Main class orchestrating the multi-agent system for developer insights reporting.
    
    This class coordinates between the four agents:
    - Orchestrator (this class): CLI and workflow management
    - Ingestor: Data acquisition and JSON parsing
    - Nexus: Data transformation and aggregation  
    - Viz: Excel generation with styling and visualization
    """
    
    def __init__(self):
        self.logger = self._setup_logging()
        self.ingestor = IngestorAgent(self.logger)
        self.nexus = NexusAgent(self.logger)
        self.viz = VizAgent(self.logger)
        
    def _setup_logging(self) -> logging.Logger:
        """Configure logging for the application"""
        logger = logging.getLogger('developer_insights')
        logger.setLevel(logging.DEBUG)
        
        # Create console handler
        handler = logging.StreamHandler()
        formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        
        return logger
    
    def run(self, args: argparse.Namespace) -> None:
        """
        Main orchestration method coordinating all agents.
        
        Args:
            args: Parsed command line arguments
        """
        try:
            # Configure logging level based on args
            if args.debug:
                self.logger.setLevel(logging.DEBUG)
            elif args.verbose:
                self.logger.setLevel(logging.INFO)
            else:
                self.logger.setLevel(logging.WARNING)
                
            self.logger.info("🚀 Starting Developer Insights Excel Generator")
            self.logger.debug(f"Arguments: {vars(args)}")
            
            # Phase 1: Ingestor Agent - Data Acquisition
            self.logger.info("📥 Phase 1: Data Acquisition (Ingestor Agent)")
            json_data, processing_result = self.ingestor.process_directory(
                args.directory, args.ignore_pattern
            )
            
            if not json_data:
                self.logger.error("❌ No valid JSON files found to process")
                sys.exit(1)
                
            self.logger.info(f"✅ Processed {processing_result.files_processed} files")
            
            # Phase 2: Nexus Agent - Data Transformation
            self.logger.info("🔄 Phase 2: Data Transformation (Nexus Agent)")
            dataframes = self.nexus.transform_data(json_data)
            
            # Phase 3: Viz Agent - Excel Generation
            self.logger.info("📊 Phase 3: Excel Generation (Viz Agent)")
            output_path = self._generate_output_path(args)
            
            # Pass export options to VizAgent
            self.viz.export_json = args.export_json
            self.viz.json_indent = args.json_indent
            
            self.viz.generate_excel_report(dataframes, output_path, json_data)
            
            self.logger.info(f"🎉 Report generated successfully: {output_path}")
            
            # Print summary
            self._print_summary(processing_result, output_path, args.export_json)
            
        except Exception as e:
            self.logger.error(f"❌ Fatal error: {str(e)}")
            if args.debug:
                self.logger.exception("Full traceback:")
            sys.exit(1)
    
    def _generate_output_path(self, args: argparse.Namespace) -> str:
        """Generate the output file path based on arguments"""
        os.makedirs(args.outputDir, exist_ok=True)
        
        if args.filename:
            filename = args.filename
            if not filename.endswith('.xlsx'):
                filename += '.xlsx'
        else:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"developer_insights_report_{timestamp}.xlsx"
            
        return os.path.join(args.outputDir, filename)
    
    def _print_summary(self, result: ProcessingResult, output_path: str, export_json: bool) -> None:
        """Print processing summary to console"""
        print("\n" + "="*60)
        print("📋 PROCESSING SUMMARY")
        print("="*60)
        print(f"Files Processed: {result.files_processed}")
        print(f"Files Skipped: {result.files_skipped}")
        print(f"Files Failed: {result.files_failed}")
        print(f"Total Records: {result.total_records}")
        print(f"Excel Output: {output_path}")
        
        if export_json:
            json_path = output_path.replace('.xlsx', '_worksheets.json')
            print(f"JSON Output: {json_path}")
        
        if result.error_messages:
            print(f"\n⚠️  Errors Encountered ({len(result.error_messages)}):")
            for error in result.error_messages[:5]:  # Show first 5 errors
                print(f"  • {error}")
            if len(result.error_messages) > 5:
                print(f"  ... and {len(result.error_messages) - 5} more")
        
        print("="*60)


class IngestorAgent:
    """
    Ingestor AI Agent - Data Acquisition Layer
    
    Responsibilities:
    - Scan input directory for JSON files
    - Apply ignore patterns  
    - Load and parse valid files into memory
    - Skip and log malformed files with details
    - Provide summary of all files loaded
    """
    
    def __init__(self, logger: logging.Logger):
        self.logger = logger
        
    def process_directory(self, directory: str, ignore_pattern: str) -> Tuple[List[Dict], ProcessingResult]:
        """
        Process all JSON files in the specified directory.
        
        Args:
            directory: Directory path to scan
            ignore_pattern: Glob pattern for files to ignore
            
        Returns:
            Tuple of (parsed_json_data_list, processing_result)
        """
        result = ProcessingResult()
        json_data = []
        
        # Scan for JSON files
        json_files = self._discover_json_files(directory, ignore_pattern)
        self.logger.info(f"📁 Found {len(json_files)} JSON files to process")
        
        # Process each file
        for file_path in json_files:
            try:
                data = self._parse_json_file(file_path)
                if data:
                    json_data.append(data)
                    result.files_processed += 1
                    
                    # Count records if summary exists
                    if 'summary' in data and 'totalCommits' in data['summary']:
                        result.total_records += data['summary']['totalCommits']
                        
                else:
                    result.files_skipped += 1
                    
            except Exception as e:
                result.files_failed += 1
                error_msg = f"Failed to process {file_path}: {str(e)}"
                result.error_messages.append(error_msg)
                self.logger.error(error_msg)
                
        return json_data, result
    
    def _discover_json_files(self, directory: str, ignore_pattern: str) -> List[str]:
        """Discover JSON files in directory, applying ignore patterns"""
        if not os.path.exists(directory):
            raise ValueError(f"Directory does not exist: {directory}")
            
        # Find all JSON files
        json_pattern = os.path.join(directory, "**", "*.json")
        all_files = glob.glob(json_pattern, recursive=True)
        
        # Apply ignore pattern if specified
        if ignore_pattern:
            ignored_files = set()
            ignore_patterns = [p.strip() for p in ignore_pattern.split(',')]
            
            for pattern in ignore_patterns:
                ignored_pattern = os.path.join(directory, "**", pattern)
                ignored = glob.glob(ignored_pattern, recursive=True)
                ignored_files.update(ignored)
                
            # Filter out ignored files
            filtered_files = [f for f in all_files if f not in ignored_files]
            self.logger.debug(f"🚫 Ignored {len(ignored_files)} files matching pattern: {ignore_pattern}")
            return filtered_files
            
        return all_files
    
    def _parse_json_file(self, file_path: str) -> Optional[Dict]:
        """
        Parse a single JSON file with detailed error handling.
        
        Args:
            file_path: Path to JSON file
            
        Returns:
            Parsed JSON data or None if invalid
            
        Raises:
            Exception: For file access or parsing errors
        """
        try:
            self.logger.debug(f"📄 Processing file: {file_path}")
            
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                
            # Validate basic structure
            if not isinstance(data, dict):
                raise ValueError("JSON file must contain an object at root level")
                
            # Check for required fields
            if 'summary' not in data and 'commits' not in data:
                self.logger.warning(f"⚠️  File missing 'summary' or 'commits': {file_path}")
                
            # Add source file metadata
            data['_source_file'] = os.path.basename(file_path)
            data['_source_path'] = file_path
            
            self.logger.debug(f"✅ Successfully parsed: {file_path}")
            return data
            
        except json.JSONDecodeError as e:
            raise Exception(f"Invalid JSON syntax at line {e.lineno}, column {e.colno}: {e.msg}")
        except UnicodeDecodeError as e:
            raise Exception(f"File encoding error: {e}")
        except Exception as e:
            raise Exception(f"File processing error: {e}")


class NexusAgent:
    """
    Nexus AI Agent - Data Transformation Layer
    
    Responsibilities:
    - Flatten nested JSON into clean tables using Pandas
    - Define and populate DataFrames for different views
    - Convert data types, clean values, and calculate derived metrics
    - Prepare data for Excel visualization
    """
    
    def __init__(self, logger: logging.Logger):
        self.logger = logger
        
    def transform_data(self, json_data_list: List[Dict]) -> Dict[str, pd.DataFrame]:
        """
        Transform list of JSON data into structured DataFrames.
        
        Args:
            json_data_list: List of parsed JSON data from files
            
        Returns:
            Dictionary of DataFrames keyed by worksheet name
        """
        self.logger.info("🔄 Starting data transformation...")
        
        dataframes = {}
        
        # Aggregate all data
        aggregated_data = self._aggregate_json_data(json_data_list)
        
        # Create different DataFrame views
        dataframes['Contributor Analysis'] = self._create_contributor_analysis(aggregated_data)
        dataframes['Repository Summary'] = self._create_repository_summary(aggregated_data)
        dataframes['All Commits'] = self._create_commits_df(aggregated_data)
        dataframes['All File Changes'] = self._create_file_changes_df(aggregated_data)
        dataframes['All Pull Requests'] = self._create_pull_requests_df(aggregated_data)
        dataframes['Work Patterns Avg'] = self._create_work_patterns_df(aggregated_data)
        dataframes['Commit Heatmap Weekly'] = self._create_weekly_heatmap(aggregated_data)
        dataframes['Commit Heatmap Yearly'] = self._create_yearly_heatmap(aggregated_data)
        dataframes['PR Commit Analysis'] = self._create_pr_commit_analysis(aggregated_data)
        dataframes['PR Contributor Speed'] = self._create_contributor_speed(aggregated_data)
        dataframes['Repo Matrix'] = self._create_repo_matrix(aggregated_data)
        dataframes['Multi Author PR'] = self._create_multi_author_prs(aggregated_data)
        dataframes['No Pull Request Analysis'] = self._create_direct_commits_analysis(aggregated_data)
        dataframes['JSON Files Loaded'] = self._create_files_loaded_df(json_data_list)
        
        self.logger.info(f"✅ Created {len(dataframes)} DataFrames")
        
        return dataframes
    
    def _aggregate_json_data(self, json_data_list: List[Dict]) -> Dict:
        """Aggregate data from multiple JSON files"""
        aggregated = {
            'all_commits': [],
            'all_repositories': {},
            'all_pull_requests': {},
            'meta_tags': {},
            'summary_stats': {
                'total_commits': 0,
                'total_additions': 0,
                'total_deletions': 0,
                'total_files_changed': 0,
                'unique_repositories': set(),
                'unique_authors': set()
            }
        }
        
        for data in json_data_list:
            # Aggregate commits
            if 'commits' in data:
                for commit in data['commits']:
                    # Add userId field for tracking
                    if 'userId' not in commit:
                        commit['userId'] = commit.get('author', 'unknown')
                    
                    # Add source file reference
                    commit['source_file'] = data.get('_source_file', 'unknown')
                    aggregated['all_commits'].append(commit)
                    
                    # Track unique values
                    aggregated['summary_stats']['unique_repositories'].add(commit.get('repository', 'unknown'))
                    aggregated['summary_stats']['unique_authors'].add(commit.get('author', 'unknown'))
            
            # Aggregate repository data
            if 'groupedByRepository' in data:
                for repo, repo_data in data['groupedByRepository'].items():
                    if repo not in aggregated['all_repositories']:
                        aggregated['all_repositories'][repo] = {
                            'direct': 0,
                            'pull_request': 0,
                            'totalAdditions': 0,
                            'totalDeletions': 0,
                            'totalFiles': 0,
                            'commits': [],
                            'userId': repo_data.get('userId', 'unknown')
                        }
                    
                    # Aggregate repository stats
                    agg_repo = aggregated['all_repositories'][repo]
                    agg_repo['direct'] += repo_data.get('direct', 0)
                    agg_repo['pull_request'] += repo_data.get('pull_request', 0)
                    agg_repo['totalAdditions'] += repo_data.get('totalAdditions', 0)
                    agg_repo['totalDeletions'] += repo_data.get('totalDeletions', 0)
                    agg_repo['totalFiles'] += repo_data.get('totalFiles', 0)
                    agg_repo['commits'].extend(repo_data.get('commits', []))
            
            # Aggregate pull request data
            if 'groupedByPullRequest' in data:
                for pr_key, pr_data in data['groupedByPullRequest'].items():
                    # Add userId field for tracking
                    if 'userId' not in pr_data:
                        pr_data['userId'] = pr_data.get('commits', [{}])[0].get('author', 'unknown') if pr_data.get('commits') else 'unknown'
                    aggregated['all_pull_requests'][pr_key] = pr_data
            
            # Aggregate meta tags
            if 'metaTags' in data:
                aggregated['meta_tags'].update(data['metaTags'])
            
            # Aggregate summary stats
            if 'summary' in data:
                summary = data['summary']
                stats = aggregated['summary_stats']
                stats['total_commits'] += summary.get('totalCommits', 0)
                stats['total_additions'] += summary.get('totalAdditions', 0)
                stats['total_deletions'] += summary.get('totalDeletions', 0)
                stats['total_files_changed'] += summary.get('totalFilesChanged', 0)
        
        # Convert sets to counts
        aggregated['summary_stats']['unique_repositories'] = len(aggregated['summary_stats']['unique_repositories'])
        aggregated['summary_stats']['unique_authors'] = len(aggregated['summary_stats']['unique_authors'])
        
        return aggregated
    
    def _create_contributor_analysis(self, aggregated_data: Dict) -> pd.DataFrame:
        """Create contributor analysis DataFrame with risk indicators"""
        contributors = {}
        
        for commit in aggregated_data['all_commits']:
            user_id = commit.get('userId', 'unknown')
            author = commit.get('author', 'Unknown')

            if user_id not in contributors:
                contributors[user_id] = {
                    'userId': user_id,
                    'Author': author,
                    'Total_Commits': 0,
                    'Direct_Commits': 0,
                    'PR_Commits': 0,
                    'Total_Additions': 0,
                    'Total_Deletions': 0,
                    'Avg_Commit_Size': 0,
                    'After_Hours_Commits_Percent': 0,
                    'Weekend_Commits_Percent': 0,
                    'Repositories': set(),
                    'after_hours_count': 0,
                    'weekend_count': 0,
                    'total_changes': 0
                }
            
            contributor = contributors[user_id]
            
            # Add meta tags to contributor record
            for k, v in aggregated_data['meta_tags'].items():
                contributor[k] = v

            # Basic metrics
            contributor['Total_Commits'] += 1
            if commit.get('type') == 'direct':
                contributor['Direct_Commits'] += 1
            else:
                contributor['PR_Commits'] += 1
            
            # Code metrics
            stats = commit.get('stats', {})
            additions = stats.get('additions', 0)
            deletions = stats.get('deletions', 0)
            total_changes = additions + deletions
            
            contributor['Total_Additions'] += additions
            contributor['Total_Deletions'] += deletions
            contributor['total_changes'] += total_changes
            contributor['Repositories'].add(commit.get('repository', 'unknown'))
            
            # Time analysis
            commit_date = self._parse_date(commit.get('date'))
            if commit_date:
                # After hours (before 8 AM or after 6 PM)
                hour = commit_date.hour
                if hour < 8 or hour > 18:
                    contributor['after_hours_count'] += 1
                
                # Weekend commits
                if commit_date.weekday() >= 5:  # Saturday = 5, Sunday = 6
                    contributor['weekend_count'] += 1
        
        # Convert to DataFrame and calculate derived metrics
        df_data = []
        for user_id, data in contributors.items():
            row = data.copy()
            
            # Convert sets to counts
            row['Unique_Repositories'] = len(row['Repositories'])
            
            # Calculate percentages and rates
            total_commits = row['Total_Commits']
            if total_commits > 0:
                row['Direct_Commit_Rate_Percent'] = round((row['Direct_Commits'] / total_commits) * 100, 1)
                row['After_Hours_Commits_Percent'] = round((row['after_hours_count'] / total_commits) * 100, 1)
                row['Weekend_Commits_Percent'] = round((row['weekend_count'] / total_commits) * 100, 1)
                row['Avg_Commit_Size'] = round(row['total_changes'] / total_commits, 1) if total_commits > 0 else 0
            else:
                row['Direct_Commit_Rate_Percent'] = 0
                row['After_Hours_Commits_Percent'] = 0
                row['Weekend_Commits_Percent'] = 0
                row['Avg_Commit_Size'] = 0
            
            # Remove temporary fields
            del row['Repositories']
            del row['after_hours_count']
            del row['weekend_count']
            del row['total_changes']
            
            df_data.append(row)
        
        df = pd.DataFrame(df_data)
        
        # Sort by total commits descending
        if not df.empty:
            df = df.sort_values('Total_Commits', ascending=False)
        
        return df
    
    def _create_commits_df(self, aggregated_data: Dict) -> pd.DataFrame:
        """Create detailed commits DataFrame"""
        commits_data = []
        
        for commit in aggregated_data['all_commits']:
            row = {
                'userId': commit.get('userId', 'unknown'),
                'SHA': commit.get('sha', ''),
                'Author': commit.get('author', 'Unknown'),
                'Date': commit.get('date', ''),
                'Repository': commit.get('repository', ''),
                'Type': commit.get('type', ''),
                'PR_Number': commit.get('pullRequest'),
                'Message': commit.get('message', ''),
                'URL': commit.get('url', ''),
                'Source_File': commit.get('source_file', '')
            }
            
            # Add meta tags
            for k, v in aggregated_data['meta_tags'].items():
                row[k] = v
            
            # Add stats if available
            stats = commit.get('stats', {})
            row.update({
                'Additions': stats.get('additions', 0),
                'Deletions': stats.get('deletions', 0),
                'Total_Changes': stats.get('total', 0),
                'Files_Changed': len(commit.get('files', []))
            })
            
            # Time analysis
            commit_date = self._parse_date(commit.get('date'))
            if commit_date:
                row['Hour'] = commit_date.hour
                row['Day_of_Week'] = commit_date.strftime('%A')
                row['Is_After_Hours'] = 1 if commit_date.hour < 8 or commit_date.hour > 18 else 0
                row['Is_Weekend'] = 1 if commit_date.weekday() >= 5 else 0
            
            commits_data.append(row)
        
        df = pd.DataFrame(commits_data)
        
        # Sort by date descending
        if not df.empty and 'Date' in df.columns:
            df = df.sort_values('Date', ascending=False)
        
        return df
    
    def _create_pull_requests_df(self, aggregated_data: Dict) -> pd.DataFrame:
        """Create pull requests DataFrame"""
        pr_data = []
        
        for pr_key, pr_info in aggregated_data['all_pull_requests'].items():
            # Parse PR key (format: "owner/repo#number")
            if '#' in pr_key:
                repo_part, pr_number = pr_key.rsplit('#', 1)
            else:
                repo_part = pr_key
                pr_number = 'Unknown'
            
            row = {
                'userId': pr_info.get('userId', 'unknown'),
                'PR_Key': pr_key,
                'Repository': pr_info.get('repository', repo_part),
                'PR_Number': pr_number,
                'Commits_Count': len(pr_info.get('commits', [])),
                'Total_Additions': pr_info.get('totalAdditions', 0),
                'Total_Deletions': pr_info.get('totalDeletions', 0),
                'Total_Files': pr_info.get('totalFiles', 0)
            }
            
            # Add meta tags
            for k, v in aggregated_data['meta_tags'].items():
                row[k] = v
            
            # Analyze commits in PR
            commits = pr_info.get('commits', [])
            if commits:
                dates = [self._parse_date(c.get('date')) for c in commits]
                valid_dates = [d for d in dates if d]
                
                if valid_dates:
                    row['First_Commit_Date'] = min(valid_dates).isoformat()
                    row['Last_Commit_Date'] = max(valid_dates).isoformat()
                    
                    # Calculate cycle time (days between first and last commit)
                    cycle_time = (max(valid_dates) - min(valid_dates)).days
                    row['Cycle_Time_Days'] = cycle_time
                
                # Get unique authors
                authors = set(c.get('author') for c in commits if c.get('author'))
                row['Authors'] = '; '.join(sorted(authors))
                row['Authors_Count'] = len(authors)
            
            pr_data.append(row)
        
        df = pd.DataFrame(pr_data)
        
        # Sort by cycle time descending
        if not df.empty and 'Cycle_Time_Days' in df.columns:
            df = df.sort_values('Cycle_Time_Days', ascending=False, na_position='last')
        
        return df
    
    def _create_file_changes_df(self, aggregated_data: Dict) -> pd.DataFrame:
        """Create file changes DataFrame"""
        file_changes = []
        
        for commit in aggregated_data['all_commits']:
            commit_sha = commit.get('sha', '')
            commit_author = commit.get('author', 'Unknown')
            commit_date = commit.get('date', '')
            repository = commit.get('repository', '')
            pr_number = commit.get('pullRequest')
            user_id = commit.get('userId', 'unknown')
            
            for file_info in commit.get('files', []):
                row = {
                    'userId': user_id,
                    'Filename': file_info.get('filename', ''),
                    'Commit_SHA': commit_sha,
                    'Commit_Author': commit_author,
                    'PR_Number': pr_number,
                    'Status': file_info.get('status', ''),
                    'Additions': file_info.get('additions', 0),
                    'Deletions': file_info.get('deletions', 0)
                }
                
                # Add meta tags
                for k, v in aggregated_data['meta_tags'].items():
                    row[k] = v

                file_changes.append(row)
        
        df = pd.DataFrame(file_changes)
        
        # Sort by changes descending
        if not df.empty:
            df['Total_Changes'] = df['Additions'] + df['Deletions']
            df = df.sort_values('Total_Changes', ascending=False)
        
        return df
    
    def _create_work_patterns_df(self, aggregated_data: Dict) -> pd.DataFrame:
        """Create work patterns analysis DataFrame"""
        patterns = {}

        for commit in aggregated_data['all_commits']:
            user_id = commit.get('userId', 'unknown')
            author = commit.get('author', 'Unknown')
            commit_date = self._parse_date(commit.get('date'))
            
            if not commit_date:
                continue
                
            if user_id not in patterns:
                patterns[user_id] = {
                    'userId': user_id,
                    'Contributor_Name': author,
                    'total_commits': 0,
                    'after_hours_commits': 0,
                    'weekend_commits': 0,
                    'peak_hour': 0,
                    'hour_counts': [0] * 24
                }
            
            pattern = patterns[user_id]
            pattern['total_commits'] += 1
            pattern['hour_counts'][commit_date.hour] += 1
            
            # Track after hours and weekend work
            if commit_date.hour < 8 or commit_date.hour > 18:
                pattern['after_hours_commits'] += 1
            
            if commit_date.weekday() >= 5:
                pattern['weekend_commits'] += 1
        
        # Convert to DataFrame
        work_data = []
        for user_id, data in patterns.items():
            row = {'userId': user_id, 'Contributor_Name': data['Contributor_Name']}
            
            # Calculate work pattern metrics
            total = data['total_commits']
            if total > 0:
                # After hours percentage
                row['After_Hours_Percentage'] = round((data['after_hours_commits'] / total) * 100, 1)
                
                # Weekend percentage
                row['Weekend_Percentage'] = round((data['weekend_commits'] / total) * 100, 1)
                
                # Peak hour
                peak_hour = data['hour_counts'].index(max(data['hour_counts']))
                row['Peak_Hour'] = f"{peak_hour:02d}:00"
                
                # Add meta tags
                for k, v in aggregated_data['meta_tags'].items():
                    row[k] = v

            work_data.append(row)
        
        df = pd.DataFrame(work_data)
        
        # Sort by after hours percentage descending
        if not df.empty and 'After_Hours_Percentage' in df.columns:
            df = df.sort_values('After_Hours_Percentage', ascending=False)
        
        return df
    
    def _create_weekly_heatmap(self, aggregated_data: Dict) -> pd.DataFrame:
        """Create weekly commit activity heatmap data"""
        days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
        heatmap_data = []
        
        # Count commits by userId, day and hour
        activity_grid = {}
        for commit in aggregated_data['all_commits']:
            user_id = commit.get('userId', 'unknown')
            commit_date = self._parse_date(commit.get('date'))
            if commit_date:
                day_name = commit_date.strftime('%A')
                hour = commit_date.hour
                
                if user_id not in activity_grid:
                    activity_grid[user_id] = {}
                    for day in days:
                        activity_grid[user_id][day] = [0] * 24
                
                activity_grid[user_id][day_name][hour] += 1
        
        # Convert to DataFrame format
        for user_id, user_data in activity_grid.items():
            for day in days:
                for hour in range(24):
                    row = {
                        'userId': user_id,
                        'Day': day,
                        'Hour': f"{hour:02d}:00",
                        'Hour_Number': hour,
                        'Commits': user_data[day][hour]
                    }
                    
                    # Add meta tags
                    for k, v in aggregated_data['meta_tags'].items():
                        row[k] = v
                    
                    heatmap_data.append(row)
        
        return pd.DataFrame(heatmap_data)
    
    def _create_yearly_heatmap(self, aggregated_data: Dict) -> pd.DataFrame:
        """Create yearly commit activity heatmap data"""
        months = ['January', 'February', 'March', 'April', 'May', 'June',
                 'July', 'August', 'September', 'October', 'November', 'December']
        heatmap_data = []
        
        # Count commits by userId and month
        activity_grid = {}
        for commit in aggregated_data['all_commits']:
            user_id = commit.get('userId', 'unknown')
            commit_date = self._parse_date(commit.get('date'))
            if commit_date:
                month_name = commit_date.strftime('%B')
                
                if user_id not in activity_grid:
                    activity_grid[user_id] = {month: 0 for month in months}
                
                activity_grid[user_id][month_name] += 1
        
        # Convert to DataFrame format
        for user_id, user_data in activity_grid.items():
            for month in months:
                row = {
                    'userId': user_id,
                    'Month': month,
                    'Commits': user_data[month]
                }
                
                # Add meta tags
                for k, v in aggregated_data['meta_tags'].items():
                    row[k] = v
                
                heatmap_data.append(row)
        
        return pd.DataFrame(heatmap_data)
    
    def _create_pr_commit_analysis(self, aggregated_data: Dict) -> pd.DataFrame:
        """Create PR commit analysis DataFrame"""
        pr_analysis = []
        
        for pr_key, pr_info in aggregated_data['all_pull_requests'].items():
            if '#' in pr_key:
                repo_part, pr_number = pr_key.rsplit('#', 1)
            else:
                repo_part = pr_key
                pr_number = 'Unknown'
            
            commits = pr_info.get('commits', [])
            if commits:
                dates = [self._parse_date(c.get('date')) for c in commits]
                valid_dates = [d for d in dates if d]
                
                row = {
                    'userId': pr_info.get('userId', 'unknown'),
                    'Repository': pr_info.get('repository', repo_part),
                    'PR_Number': pr_number,
                    'Author_s': '; '.join(set(c.get('author', '') for c in commits if c.get('author'))),
                    'Commit_Count': len(commits),
                    'Total_Additions': pr_info.get('totalAdditions', 0),
                    'Total_Deletions': pr_info.get('totalDeletions', 0),
                    'Total_Churn': pr_info.get('totalAdditions', 0) + pr_info.get('totalDeletions', 0),
                    'Files_Changed': pr_info.get('totalFiles', 0),
                    'First_Commit_Date': min(valid_dates).isoformat() if valid_dates else None,
                    'Last_Commit_Date': max(valid_dates).isoformat() if valid_dates else None,
                    'Commit_Span_Days': (max(valid_dates) - min(valid_dates)).days if len(valid_dates) > 1 else 0
                }
                
                # Add meta tags
                for k, v in aggregated_data['meta_tags'].items():
                    row[k] = v
                
                pr_analysis.append(row)
        
        df = pd.DataFrame(pr_analysis)
        
        # Sort by total churn descending
        if not df.empty:
            df = df.sort_values('Total_Churn', ascending=False)
        
        return df
    
    def _create_contributor_speed(self, aggregated_data: Dict) -> pd.DataFrame:
        """Create PR contributor speed analysis DataFrame"""
        contributor_speeds = {}
        
        # Analyze PR development time by contributor
        for pr_key, pr_info in aggregated_data['all_pull_requests'].items():
            commits = pr_info.get('commits', [])
            if not commits:
                continue
                
            # Get all contributors for this PR
            contributors = set(c.get('userId', c.get('author', 'unknown')) for c in commits)
            
            # Calculate PR span
            dates = [self._parse_date(c.get('date')) for c in commits]
            valid_dates = [d for d in dates if d]
            
            if len(valid_dates) > 1:
                span_days = (max(valid_dates) - min(valid_dates)).days
                churn = pr_info.get('totalAdditions', 0) + pr_info.get('totalDeletions', 0)
                
                for contributor in contributors:
                    if contributor not in contributor_speeds:
                        contributor_speeds[contributor] = {
                            'userId': contributor,
                            'Contributor_Name': contributor,
                            'pr_spans': [],
                            'pr_commits': [],
                            'pr_churns': []
                        }
                    
                    contributor_speeds[contributor]['pr_spans'].append(span_days)
                    contributor_speeds[contributor]['pr_commits'].append(len(commits))
                    contributor_speeds[contributor]['pr_churns'].append(churn)
        
        # Convert to DataFrame
        speed_data = []
        for contributor, data in contributor_speeds.items():
            if data['pr_spans']:  # Only include contributors with PR data
                row = {
                    'userId': contributor,
                    'Contributor_Name': data['Contributor_Name'],
                    'Total_PRs_Worked_On': len(data['pr_spans']),
                    'Average_Commit_Span_Days': round(sum(data['pr_spans']) / len(data['pr_spans']), 1),
                    'Median_Commit_Span_Days': round(sorted(data['pr_spans'])[len(data['pr_spans'])//2], 1),
                    'Longest_Commit_Span_Days': max(data['pr_spans']),
                    'Avg_Commits_per_PR': round(sum(data['pr_commits']) / len(data['pr_commits']), 1),
                    'Avg_Churn_per_PR': round(sum(data['pr_churns']) / len(data['pr_churns']), 1)
                }
                
                # Add meta tags
                for k, v in aggregated_data['meta_tags'].items():
                    row[k] = v
                
                speed_data.append(row)
        
        df = pd.DataFrame(speed_data)
        
        # Sort by average commit span descending
        if not df.empty:
            df = df.sort_values('Average_Commit_Span_Days', ascending=False)
        
        return df
    
    def _create_repo_matrix(self, aggregated_data: Dict) -> pd.DataFrame:
        """Create repository contribution matrix DataFrame"""
        matrix_data = []
        
        # Get all unique authors and repositories
        authors = set()
        repositories = set()
        
        for commit in aggregated_data['all_commits']:
            authors.add(commit.get('userId', 'unknown'))
            repositories.add(commit.get('repository', 'Unknown'))
        
        # Count commits by author and repository
        contribution_counts = {}
        for commit in aggregated_data['all_commits']:
            user_id = commit.get('userId', 'unknown')
            repo = commit.get('repository', 'Unknown')
            
            if user_id not in contribution_counts:
                contribution_counts[user_id] = {}
            
            if repo not in contribution_counts[user_id]:
                contribution_counts[user_id][repo] = 0
            
            contribution_counts[user_id][repo] += 1
        
        # Convert to DataFrame format
        for user_id in sorted(authors):
            for repo in sorted(repositories):
                commit_count = contribution_counts.get(user_id, {}).get(repo, 0)
                
                row = {
                    'userId': user_id,
                    'Repository': repo,
                    'Commit_Count': commit_count
                }
                
                # Add meta tags
                for k, v in aggregated_data['meta_tags'].items():
                    row[k] = v
                
                matrix_data.append(row)
        
        return pd.DataFrame(matrix_data)
    
    def _create_multi_author_prs(self, aggregated_data: Dict) -> pd.DataFrame:
        """Create multi-author PRs DataFrame"""
        multi_author_prs = []
        
        for pr_key, pr_info in aggregated_data['all_pull_requests'].items():
            commits = pr_info.get('commits', [])
            authors = set(c.get('userId', c.get('author', 'unknown')) for c in commits)
            
            # Only include PRs with multiple authors
            if len(authors) > 1:
                if '#' in pr_key:
                    repo_part, pr_number = pr_key.rsplit('#', 1)
                else:
                    repo_part = pr_key
                    pr_number = 'Unknown'
                
                row = {
                    'userId': pr_info.get('userId', 'unknown'),
                    'Repository': pr_info.get('repository', repo_part),
                    'PR_Number': pr_number,
                    'Collaborators': '; '.join(sorted(authors)),
                    'Total_Commits': len(commits),
                    'Total_Churn': pr_info.get('totalAdditions', 0) + pr_info.get('totalDeletions', 0)
                }
                
                # Add meta tags
                for k, v in aggregated_data['meta_tags'].items():
                    row[k] = v
                
                multi_author_prs.append(row)
        
        return pd.DataFrame(multi_author_prs)
    
    def _create_direct_commits_analysis(self, aggregated_data: Dict) -> pd.DataFrame:
        """Create direct commits analysis DataFrame"""
        direct_analysis = {}
        
        for commit in aggregated_data['all_commits']:
            user_id = commit.get('userId', 'unknown')
            author = commit.get('author', 'Unknown')
            is_direct = commit.get('type') == 'direct'
            
            if user_id not in direct_analysis:
                direct_analysis[user_id] = {
                    'userId': user_id,
                    'Author': author,
                    'Total_Commits': 0,
                    'Direct_Commits': 0
                }
            
            direct_analysis[user_id]['Total_Commits'] += 1
            if is_direct:
                direct_analysis[user_id]['Direct_Commits'] += 1
        
        # Convert to DataFrame and calculate percentages
        analysis_data = []
        for user_id, data in direct_analysis.items():
            row = data.copy()
            total = row['Total_Commits']
            if total > 0:
                row['Direct_Commit_Rate_Percent'] = round((row['Direct_Commits'] / total) * 100, 1)
            else:
                row['Direct_Commit_Rate_Percent'] = 0
            
            # Add meta tags
            for k, v in aggregated_data['meta_tags'].items():
                row[k] = v
            
            analysis_data.append(row)
        
        df = pd.DataFrame(analysis_data)
        
        # Sort by direct commit rate descending
        if not df.empty:
            df = df.sort_values('Direct_Commit_Rate_Percent', ascending=False)
        
        return df
    
    def _create_repository_summary(self, aggregated_data: Dict) -> pd.DataFrame:
        """Create repository summary DataFrame"""
        repo_data = []
        
        for repo_name, repo_info in aggregated_data['all_repositories'].items():
            row = {
                'userId': repo_info.get('userId', 'unknown'),
                'Repository_Name': repo_name,
                'Direct_Commits': repo_info.get('direct', 0),
                'PR_Commits': repo_info.get('pull_request', 0),
                'Total_Commits': repo_info.get('direct', 0) + repo_info.get('pull_request', 0),
                'Total_Additions': repo_info.get('totalAdditions', 0),
                'Total_Deletions': repo_info.get('totalDeletions', 0),
                'Total_Files_Changed': repo_info.get('totalFiles', 0)
            }
            
            # Add meta tags
            for k, v in aggregated_data['meta_tags'].items():
                row[k] = v
            
            # Calculate metrics
            total_commits = row['Total_Commits']
            if total_commits > 0:
                row['PR_Usage_Percentage'] = round((row['PR_Commits'] / total_commits) * 100, 1)
            else:
                row['PR_Usage_Percentage'] = 0
            
            # Analyze contributors
            commits = repo_info.get('commits', [])
            contributors = set(c.get('userId', c.get('author', 'unknown')) for c in commits)
            row['Contributors_Count'] = len(contributors)
            row['Contributors'] = '; '.join(sorted(contributors))
            
            repo_data.append(row)
        
        df = pd.DataFrame(repo_data)
        
        # Sort by total commits descending
        if not df.empty:
            df = df.sort_values('Total_Commits', ascending=False)
        
        return df
    
    def _create_files_loaded_df(self, json_data_list: List[Dict]) -> pd.DataFrame:
        """Create JSON files loaded tracking DataFrame"""
        files_data = []
        
        for data in json_data_list:
            row = {
                'fileName': data.get('_source_file', 'unknown'),
                'successfully_parsed': True,
                'had_error': False,
                'was_empty': len(data.get('commits', [])) == 0
            }
            files_data.append(row)
        
        return pd.DataFrame(files_data)
    
    def _parse_date(self, date_str: str) -> Optional[datetime]:
        """Parse date string to datetime object"""
        if not date_str:
            return None
            
        try:
            # Handle various ISO format variations
            if date_str.endswith('Z'):
                return datetime.fromisoformat(date_str.replace('Z', '+00:00'))
            elif '+' in date_str or date_str.count('-') > 2:
                return datetime.fromisoformat(date_str)
            else:
                # Assume UTC if no timezone
                return datetime.fromisoformat(date_str).replace(tzinfo=timezone.utc)
        except ValueError:
            return None


class VizAgent:
    """
    Viz AI Agent - Visualization & Output Layer
    
    Responsibilities:
    - Create Excel workbook using xlsxwriter
    - Populate multiple sheets with data
    - Apply conditional formatting to flag inefficiencies
    - Create filterable tables for exploration
    - Generate Data Dictionary worksheet
    - Export worksheet data as JSON (optional)
    """
    
    def __init__(self, logger: logging.Logger):
        self.logger = logger
        self.workbook = None
        self.formats = {}
        # JSON export configuration
        self.export_json = False
        self.json_indent = 4
        
    def generate_excel_report(self, dataframes: Dict[str, pd.DataFrame], 
                            output_path: str, json_data: List[Dict]) -> None:
        """
        Generate complete Excel report with multiple worksheets and optional JSON export.
        
        Args:
            dataframes: Dictionary of DataFrames to include
            output_path: Path to save Excel file
            json_data: Original JSON data for metadata
        """
        self.logger.info(f"📊 Creating Excel workbook: {output_path}")
        
        # Create workbook
        self.workbook = xlsxwriter.Workbook(output_path)
        self._create_formats()
        
        try:
            # Create worksheets
            self._create_dashboard_sheet(dataframes, json_data)
            
            # Create data sheets with conditional formatting
            for sheet_name, df in dataframes.items():
                self._create_data_sheet(sheet_name, df)
            
            # Create Data Dictionary
            self._create_data_dictionary(dataframes)
            
            self.logger.info("✅ Excel workbook created successfully")
            
        finally:
            self.workbook.close()
        
        # Export to JSON if enabled
        if self.export_json:
            json_path = self._export_worksheets_to_json(dataframes, output_path)
            if json_path:
                self.logger.info(f"📄 JSON export completed: {json_path}")
    
    def _export_worksheets_to_json(self, dataframes: Dict[str, pd.DataFrame], 
                                   excel_path: str) -> Optional[str]:
        """
        Export all worksheets data to JSON format.
        
        Args:
            dataframes: Dictionary of DataFrames from worksheets
            excel_path: Path to Excel file (used to generate JSON filename)
            
        Returns:
            Path to JSON file if successful, None otherwise
        """
        try:
            json_path = excel_path.replace('.xlsx', '_worksheets.json')
            self.logger.info(f"📄 Exporting worksheets to JSON: {json_path}")
            
            export_data = {
                "metadata": {
                    "generated_at": datetime.now().isoformat(),
                    "excel_file": os.path.basename(excel_path),
                    "total_worksheets": len(dataframes),
                    "generator": "Developer Insights Excel Report Generator",
                    "version": "1.0.0"
                },
                "worksheets": {}
            }
            
            for sheet_name, df in dataframes.items():
                if df.empty:
                    self.logger.warning(f"Skipping empty worksheet: {sheet_name}")
                    export_data["worksheets"][sheet_name] = {
                        "headers": [],
                        "data": [],
                        "row_count": 0,
                        "column_count": 0,
                        "note": "Empty worksheet"
                    }
                    continue
                    
                # Convert DataFrame to array format
                headers = df.columns.tolist()
                data = []
                
                for _, row in df.iterrows():
                    row_data = []
                    for value in row:
                        # Handle different data types for JSON serialization
                        if pd.isna(value):
                            row_data.append(None)
                        elif isinstance(value, datetime):
                            row_data.append(value.isoformat())
                        elif isinstance(value, (pd.Timestamp, pd.Timedelta)):
                            row_data.append(str(value))
                        elif isinstance(value, (int, float, bool, str)):
                            row_data.append(value)
                        else:
                            # Convert other types to string
                            row_data.append(str(value))
                    data.append(row_data)
                
                export_data["worksheets"][sheet_name] = {
                    "headers": headers,
                    "data": data,
                    "row_count": len(data),
                    "column_count": len(headers),
                    "data_types": [str(dtype) for dtype in df.dtypes.tolist()]
                }
                
                self.logger.debug(f"Exported {len(data)} rows from {sheet_name}")
            
            # Write JSON file with proper formatting
            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump(export_data, f, indent=self.json_indent, ensure_ascii=False)
            
            self.logger.info(f"✅ JSON export completed successfully: {json_path}")
            return json_path
            
        except Exception as e:
            self.logger.error(f"❌ Failed to export JSON: {str(e)}")
            return None
    
    def _create_formats(self) -> None:
        """Create reusable cell formats for styling"""
        self.formats = {
            # Headers
            'header': self.workbook.add_format({
                'bold': True,
                'bg_color': '#4472C4',
                'font_color': 'white',
                'border': 1
            }),
            'subheader': self.workbook.add_format({
                'bold': True,
                'bg_color': '#B4C6E7',
                'border': 1
            }),
            
            # Risk indicators (shade-focused colors with clear contrast)
            'risk_high': self.workbook.add_format({
                'bg_color': '#FF6B6B',  # Soft red - High risk
                'font_color': '#2C3E50',  # Dark blue-gray for contrast
                'border': 1
            }),
            'risk_medium': self.workbook.add_format({
                'bg_color': '#FFB366',  # Soft orange - Medium risk
                'font_color': '#2C3E50',  # Dark blue-gray for contrast
                'border': 1
            }),
            'risk_low': self.workbook.add_format({
                'bg_color': '#D4A574',  # Soft brown - Low input levels
                'font_color': '#2C3E50',  # Dark blue-gray for contrast
                'border': 1
            }),
            'warning': self.workbook.add_format({
                'bg_color': '#FFE066',  # Soft yellow - Warning indicators
                'font_color': '#2C3E50',  # Dark blue-gray for contrast
                'border': 1
            }),
            'good': self.workbook.add_format({
                'bg_color': '#90EE90',  # Light green - Good indicators
                'font_color': '#2C3E50',  # Dark blue-gray for contrast
                'border': 1
            }),
            
            # Data formats
            'number': self.workbook.add_format({'num_format': '#,##0'}),
            'percentage': self.workbook.add_format({'num_format': '0.0%'}),
            'date': self.workbook.add_format({'num_format': 'yyyy-mm-dd'}),
            
            # General
            'bold': self.workbook.add_format({'bold': True}),
            'center': self.workbook.add_format({'align': 'center'}),
            'border': self.workbook.add_format({'border': 1})
        }
    
    def _create_dashboard_sheet(self, dataframes: Dict[str, pd.DataFrame], 
                              json_data: List[Dict]) -> None:
        """Create executive dashboard with key metrics"""
        worksheet = self.workbook.add_worksheet('Dashboard')
        
        row = 0
        
        # Title
        worksheet.merge_range(row, 0, row, 7, 'Developer Insights Dashboard', 
                            self.formats['header'])
        worksheet.set_row(row, 30)
        row += 2
        
        # Metadata section
        worksheet.write(row, 0, 'Report Metadata', self.formats['subheader'])
        row += 1
        
        metadata_items = [
            ('Generated At', datetime.now().strftime('%Y-%m-%d %H:%M:%S')),
            ('Source Files', len(json_data)),
            ('JSON Export Enabled', 'Yes' if self.export_json else 'No'),
        ]
        
        for label, value in metadata_items:
            worksheet.write(row, 0, label, self.formats['bold'])
            worksheet.write(row, 1, str(value))
            row += 1

        row += 1
        
        # Summary metrics
        worksheet.write(row, 0, 'Key Performance Indicators', self.formats['subheader'])
        row += 1
        
        # Calculate summary from DataFrames
        if 'Contributor Analysis' in dataframes:
            contrib_df = dataframes['Contributor Analysis']
            
            summary_metrics = [
                ('Total Contributors', len(contrib_df)),
                ('Total Commits', contrib_df['Total_Commits'].sum() if 'Total_Commits' in contrib_df.columns else 0),
                ('Direct Commits', contrib_df['Direct_Commits'].sum() if 'Direct_Commits' in contrib_df.columns else 0),
                ('PR Commits', contrib_df['PR_Commits'].sum() if 'PR_Commits' in contrib_df.columns else 0),
                ('Total Code Additions', contrib_df['Total_Additions'].sum() if 'Total_Additions' in contrib_df.columns else 0),
                ('Total Code Deletions', contrib_df['Total_Deletions'].sum() if 'Total_Deletions' in contrib_df.columns else 0),
                ('Unique Repositories', contrib_df['Unique_Repositories'].sum() if 'Unique_Repositories' in contrib_df.columns else 0)
            ]
            
            for label, value in summary_metrics:
                worksheet.write(row, 0, label, self.formats['bold'])
                worksheet.write(row, 1, value, self.formats['number'])
                row += 1
        
        row += 1
        
        # Risk indicators
        worksheet.write(row, 0, 'Risk & Quality Indicators', self.formats['subheader'])
        row += 1
        
        if 'Contributor Analysis' in dataframes:
            contrib_df = dataframes['Contributor Analysis']
            
            # Calculate risk metrics
            high_direct_commits = 0
            high_after_hours = 0
            high_weekend_work = 0
            
            if not contrib_df.empty:
                if 'Direct_Commit_Rate_Percent' in contrib_df.columns:
                    high_direct_commits = (contrib_df['Direct_Commit_Rate_Percent'] > 70).sum()
                if 'After_Hours_Commits_Percent' in contrib_df.columns:
                    high_after_hours = (contrib_df['After_Hours_Commits_Percent'] > 50).sum()
                if 'Weekend_Commits_Percent' in contrib_df.columns:
                    high_weekend_work = (contrib_df['Weekend_Commits_Percent'] > 30).sum()
            
            risk_metrics = [
                ('High Direct Commit Rate (>70%)', high_direct_commits),
                ('High After-Hours Work (>50%)', high_after_hours),
                ('High Weekend Work (>30%)', high_weekend_work)
            ]
            
            for label, count in risk_metrics:
                worksheet.write(row, 0, label, self.formats['bold'])
                worksheet.write(row, 1, count)
                
                # Apply color coding based on risk level
                if count > 0:
                    if count > 3:
                        worksheet.write(row, 2, 'HIGH RISK', self.formats['risk_high'])
                    elif count > 1:
                        worksheet.write(row, 2, 'MEDIUM RISK', self.formats['risk_medium'])
                    else:
                        worksheet.write(row, 2, 'LOW RISK', self.formats['warning'])
                else:
                    worksheet.write(row, 2, 'NO RISK', self.formats['good'])
                
                row += 1
        
        # Auto-adjust column widths
        worksheet.set_column(0, 0, 30)  # Labels
        worksheet.set_column(1, 1, 15)  # Values
        worksheet.set_column(2, 2, 15)  # Risk level
    
    def _create_data_sheet(self, sheet_name: str, df: pd.DataFrame) -> None:
        """Create a data sheet with conditional formatting"""
        if df.empty:
            self.logger.warning(f"⚠️  Skipping empty DataFrame: {sheet_name}")
            return
            
        worksheet = self.workbook.add_worksheet(sheet_name)
        
        # Write headers
        for col, column_name in enumerate(df.columns):
            worksheet.write(0, col, column_name, self.formats['header'])
        
        # Write data
        for row_idx, (_, row) in enumerate(df.iterrows(), start=1):
            for col_idx, value in enumerate(row):
                # Handle different data types
                if pd.isna(value):
                    worksheet.write(row_idx, col_idx, '')
                elif isinstance(value, (int, float)):
                    worksheet.write(row_idx, col_idx, value, self.formats['number'])
                else:
                    worksheet.write(row_idx, col_idx, str(value))
        
        # Apply conditional formatting based on sheet type
        self._apply_conditional_formatting(worksheet, sheet_name, df)
        
        # Create auto-filter
        if len(df) > 0:
            worksheet.autofilter(0, 0, len(df), len(df.columns) - 1)
        
        # Freeze top row
        worksheet.freeze_panes(1, 0)
        
        # Auto-adjust column widths
        for col_idx, column in enumerate(df.columns):
            # Calculate width based on column content
            max_length = max(
                len(str(column)),
                df[column].astype(str).str.len().max() if len(df) > 0 else 0
            )
            width = min(max_length + 2, 50)  # Cap at 50 characters
            worksheet.set_column(col_idx, col_idx, width)
    
    def _apply_conditional_formatting(self, worksheet, sheet_name: str, df: pd.DataFrame) -> None:
        """Apply conditional formatting rules based on inefficiency indicators"""
        if df.empty:
            return
            
        data_rows = len(df)
        
        if sheet_name == 'Contributor Analysis':
            # High direct commit rate (reduced participation)
            if 'Direct_Commit_Rate_Percent' in df.columns:
                col_idx = df.columns.get_loc('Direct_Commit_Rate_Percent')
                col_letter = xl_col_to_name(col_idx)
                
                # Very high direct commits (>70%) - Red
                worksheet.conditional_format(
                    f'{col_letter}2:{col_letter}{data_rows + 1}',
                    {
                        'type': 'cell',
                        'criteria': '>=',
                        'value': 70,
                        'format': self.formats['risk_high']
                    }
                )
                
                # High direct commits (50-70%) - Orange
                worksheet.conditional_format(
                    f'{col_letter}2:{col_letter}{data_rows + 1}',
                    {
                        'type': 'cell',
                        'criteria': 'between',
                        'minimum': 50,
                        'maximum': 69.9,
                        'format': self.formats['risk_medium']
                    }
                )
            
            # After-hours percentage highlighting
            if 'After_Hours_Commits_Percent' in df.columns:
                col_idx = df.columns.get_loc('After_Hours_Commits_Percent')
                col_letter = xl_col_to_name(col_idx)
                
                # High after-hours (>50%) - Red (reduced participation)
                worksheet.conditional_format(
                    f'{col_letter}2:{col_letter}{data_rows + 1}',
                    {
                        'type': 'cell',
                        'criteria': '>=',
                        'value': 50,
                        'format': self.formats['risk_high']
                    }
                )
                
                # Medium after-hours (25-50%) - Yellow warning
                worksheet.conditional_format(
                    f'{col_letter}2:{col_letter}{data_rows + 1}',
                    {
                        'type': 'cell',
                        'criteria': 'between',
                        'minimum': 25,
                        'maximum': 49.9,
                        'format': self.formats['warning']
                    }
                )
            
            # Weekend work highlighting
            if 'Weekend_Commits_Percent' in df.columns:
                col_idx = df.columns.get_loc('Weekend_Commits_Percent')
                col_letter = xl_col_to_name(col_idx)
                
                # High weekend work (>30%) - Orange
                worksheet.conditional_format(
                    f'{col_letter}2:{col_letter}{data_rows + 1}',
                    {
                        'type': 'cell',
                        'criteria': '>=',
                        'value': 30,
                        'format': self.formats['risk_medium']
                    }
                )
            
            # Large commit size highlighting  
            if 'Avg_Commit_Size' in df.columns:
                col_idx = df.columns.get_loc('Avg_Commit_Size')
                col_letter = xl_col_to_name(col_idx)
                
                # Very large commits (>500 lines) - Yellow warning
                worksheet.conditional_format(
                    f'{col_letter}2:{col_letter}{data_rows + 1}',
                    {
                        'type': 'cell',
                        'criteria': '>=',
                        'value': 500,
                        'format': self.formats['warning']
                    }
                )
        
        elif sheet_name == 'All Pull Requests':
            # PR cycle time highlighting
            if 'Cycle_Time_Days' in df.columns:
                col_idx = df.columns.get_loc('Cycle_Time_Days')
                col_letter = xl_col_to_name(col_idx)
                
                # Very slow cycle time (>10 days) - Red
                worksheet.conditional_format(
                    f'{col_letter}2:{col_letter}{data_rows + 1}',
                    {
                        'type': 'cell',
                        'criteria': '>=',
                        'value': 10,
                        'format': self.formats['risk_high']
                    }
                )
                
                # Slow cycle time (5-10 days) - Yellow warning
                worksheet.conditional_format(
                    f'{col_letter}2:{col_letter}{data_rows + 1}',
                    {
                        'type': 'cell',
                        'criteria': 'between',
                        'minimum': 5,
                        'maximum': 9.9,
                        'format': self.formats['warning']
                    }
                )
        
        elif sheet_name == 'All Commits':
            # Large commit highlighting
            if 'Total_Changes' in df.columns:
                col_idx = df.columns.get_loc('Total_Changes')
                col_letter = xl_col_to_name(col_idx)
                
                # Very large commits (>1000 lines) - Red
                worksheet.conditional_format(
                    f'{col_letter}2:{col_letter}{data_rows + 1}',
                    {
                        'type': 'cell',
                        'criteria': '>=',
                        'value': 1000,
                        'format': self.formats['risk_high']
                    }
                )
                
                # Large commits (500-1000 lines) - Yellow warning
                worksheet.conditional_format(
                    f'{col_letter}2:{col_letter}{data_rows + 1}',
                    {
                        'type': 'cell',
                        'criteria': 'between',
                        'minimum': 500,
                        'maximum': 999,
                        'format': self.formats['warning']
                    }
                )
            
            # After-hours commits
            if 'Is_After_Hours' in df.columns:
                col_idx = df.columns.get_loc('Is_After_Hours')
                col_letter = xl_col_to_name(col_idx)
                
                # After-hours commits - Yellow warning
                worksheet.conditional_format(
                    f'{col_letter}2:{col_letter}{data_rows + 1}',
                    {
                        'type': 'cell',
                        'criteria': '=',
                        'value': 1,
                        'format': self.formats['warning']
                    }
                )
            
            # Weekend commits
            if 'Is_Weekend' in df.columns:
                col_idx = df.columns.get_loc('Is_Weekend')
                col_letter = xl_col_to_name(col_idx)
                
                # Weekend commits - Orange (medium risk)
                worksheet.conditional_format(
                    f'{col_letter}2:{col_letter}{data_rows + 1}',
                    {
                        'type': 'cell',
                        'criteria': '=',
                        'value': 1,
                        'format': self.formats['risk_medium']
                    }
                )
        
        elif sheet_name == 'No Pull Request Analysis':
            # Direct commit rate highlighting (low input levels)
            if 'Direct_Commit_Rate_Percent' in df.columns:
                col_idx = df.columns.get_loc('Direct_Commit_Rate_Percent')
                col_letter = xl_col_to_name(col_idx)
                
                # Very high direct commit rate (>80%) - Brown (low input levels)
                worksheet.conditional_format(
                    f'{col_letter}2:{col_letter}{data_rows + 1}',
                    {
                        'type': 'cell',
                        'criteria': '>=',
                        'value': 80,
                        'format': self.formats['risk_low']
                    }
                )
                
                # High direct commit rate (50-80%) - Yellow warning
                worksheet.conditional_format(
                    f'{col_letter}2:{col_letter}{data_rows + 1}',
                    {
                        'type': 'cell',
                        'criteria': 'between',
                        'minimum': 50,
                        'maximum': 79.9,
                        'format': self.formats['warning']
                    }
                )
    
    def _create_data_dictionary(self, dataframes: Dict[str, pd.DataFrame]) -> None:
        """Create comprehensive data dictionary worksheet"""
        worksheet = self.workbook.add_worksheet('Data Dictionary')
        
        # Headers
        headers = [
            'Worksheet Name',
            'Column Name', 
            'Value Description',
            'Source / Criteria',
            'Formula (if any)'
        ]
        
        for col, header in enumerate(headers):
            worksheet.write(0, col, header, self.formats['header'])
        
        row = 1
        
        # Document each DataFrame
        for sheet_name, df in dataframes.items():
            if df.empty:
                continue
                
            for column in df.columns:
                # Worksheet name
                worksheet.write(row, 0, sheet_name)
                
                # Column name
                worksheet.write(row, 1, column)
                
                # Value description and source
                description, source, formula = self._get_column_documentation(sheet_name, column)
                worksheet.write(row, 2, description)
                worksheet.write(row, 3, source)
                worksheet.write(row, 4, formula)
                
                row += 1
        
        # Add script logic explanation
        row += 2
        worksheet.write(row, 0, 'Script Logic Overview', self.formats['subheader'])
        row += 1
        
        logic_explanation = [
            "Multi-Agent Architecture:",
            "1. Orchestrator Agent: Manages CLI interface and coordinates workflow between agents",
            "2. Ingestor Agent: Scans directory for JSON files, applies ignore patterns, parses and validates data",
            "3. Nexus Agent: Aggregates data from multiple files, transforms to pandas DataFrames, calculates metrics",
            "4. Viz Agent: Creates Excel workbook with conditional formatting and exports JSON data",
            "",
            "Risk Detection Logic:",
            "- Red shading: High risk (>50% after-hours, >70% direct commits, reduced participation)",
            "- Orange shading: Medium risk (weekend work, 50-70% direct commits)",
            "- Brown shading: Low input levels (>80% direct commits, no PR usage)",
            "- Yellow shading: Warning indicators (slow cycles, large commits, 25-50% after-hours)",
            "- Green shading: Good indicators (healthy collaboration patterns)",
            "",
            "Data Sources:",
            "- commits[]: Individual commit data from JSON files with userId tracking",
            "- groupedByRepository: Repository-level aggregations with userId", 
            "- groupedByPullRequest: Pull request-level aggregations with userId",
            "- metaTags: User-defined metadata from JSON files",
            "- Derived metrics calculated from commit timestamps, stats, and patterns",
            "",
            "Inefficiency Indicators:",
            "- High direct commit rates indicate bypassing code review processes",
            "- Excessive after-hours/weekend work suggests poor work-life balance",
            "- Large commits indicate insufficient decomposition of work",
            "- Long PR cycle times suggest process bottlenecks",
            "- Low cross-repository contribution indicates knowledge silos"
        ]
        
        for explanation in logic_explanation:
            worksheet.write(row, 0, explanation)
            row += 1
        
        # Auto-adjust column widths
        worksheet.set_column(0, 0, 20)  # Worksheet Name
        worksheet.set_column(1, 1, 25)  # Column Name
        worksheet.set_column(2, 2, 60)  # Value Description
        worksheet.set_column(3, 3, 40)  # Source / Criteria
        worksheet.set_column(4, 4, 30)  # Formula
    
    def _get_column_documentation(self, sheet_name: str, column: str) -> Tuple[str, str, str]:
        """Get documentation for a specific column"""
        
        # Common column documentation
        common_docs = {
            'userId': ('User ID or unique identifier for the contributor', 'commits[].userId OR commits[].author', 'N/A'),
            'Author': ('Author name of the commit or contributor', 'commits[].author', 'N/A'),
            'Total_Commits': ('Total number of commits by this contributor', 'COUNT(commits[] where userId matches)', 'COUNT(commits)'),
            'Direct_Commits': ('Commits made directly to branches (not via PR)', 'commits[].type == "direct"', 'COUNTIF(type,"direct")'),
            'PR_Commits': ('Commits made via pull requests', 'commits[].type == "pull_request"', 'COUNTIF(type,"pull_request")'),
            'Total_Additions': ('Total lines of code added', 'SUM(commits[].stats.additions)', 'SUM(additions)'),
            'Total_Deletions': ('Total lines of code deleted', 'SUM(commits[].stats.deletions)', 'SUM(deletions)'),
            'Direct_Commit_Rate_Percent': ('Percentage of commits made directly (bypassing PR process)', 'direct_commits / total_commits * 100', '(direct/total)*100'),
            'After_Hours_Commits_Percent': ('Percentage of commits made outside business hours (8AM-6PM)', 'after_hours_commits / total_commits * 100', '(after_hours/total)*100'),
            'Weekend_Commits_Percent': ('Percentage of commits made on weekends', 'weekend_commits / total_commits * 100', '(weekend/total)*100'),
            'Avg_Commit_Size': ('Average number of lines changed per commit', 'total_changes / total_commits', 'total_changes/total_commits'),
            'SHA': ('Unique SHA hash identifier for the commit', 'commits[].sha', 'N/A'),
            'Date': ('Date and time when commit was made', 'commits[].date', 'N/A'),
            'Repository': ('Repository name in owner/repo format', 'commits[].repository', 'N/A'),
            'Type': ('Type of commit: direct or pull_request', 'commits[].type', 'N/A'),
            'PR_Number': ('Pull request number if applicable', 'commits[].pullRequest', 'N/A'),
            'Message': ('Commit message text', 'commits[].message', 'N/A'),
            'URL': ('GitHub URL to the commit', 'commits[].url', 'N/A'),
            'Source_File': ('JSON file this data was extracted from', 'Added during processing', 'N/A'),
            'Additions': ('Lines of code added in this commit', 'commits[].stats.additions', 'N/A'),
            'Deletions': ('Lines of code deleted in this commit', 'commits[].stats.deletions', 'N/A'),
            'Total_Changes': ('Total lines changed (additions + deletions)', 'commits[].stats.total', 'additions + deletions'),
            'Files_Changed': ('Number of files changed in this commit', 'LENGTH(commits[].files)', 'COUNT(files)'),
            'Is_After_Hours': ('1 if commit made before 8AM or after 6PM, 0 otherwise', 'HOUR < 8 OR HOUR > 18', 'IF(OR(HOUR<8,HOUR>18),1,0)'),
            'Is_Weekend': ('1 if commit made on weekend, 0 otherwise', 'WEEKDAY = Saturday OR Sunday', 'IF(WEEKDAY>=6,1,0)'),
            'Unique_Repositories': ('Number of unique repositories this contributor worked on', 'COUNT(DISTINCT(repository))', 'COUNT(DISTINCT(repository))'),
        }
        
        # Sheet-specific documentation
        sheet_specific = {
            'All Pull Requests': {
                'PR_Key': ('Unique identifier in format owner/repo#number', 'groupedByPullRequest key', 'N/A'),
                'Commits_Count': ('Number of commits in this pull request', 'LENGTH(groupedByPullRequest[].commits)', 'COUNT(commits)'),
                'Cycle_Time_Days': ('Days between first and last commit in PR', 'Last_Commit_Date - First_Commit_Date', 'last_date - first_date'),
                'Authors': ('Semicolon-separated list of commit authors', 'DISTINCT(commits[].author)', 'TEXTJOIN(";",UNIQUE(authors))'),
                'Authors_Count': ('Number of unique authors in this PR', 'COUNT(DISTINCT(commits[].author))', 'COUNT(UNIQUE(authors))')
            },
            'All File Changes': {
                'Filename': ('Name and path of the changed file', 'commits[].files[].filename', 'N/A'),
                'Status': ('Type of change: added/modified/removed/renamed', 'commits[].files[].status', 'N/A')
            },
            'Commit Heatmap Weekly': {
                'Day': ('Day of the week', 'DAYNAME(commits[].date)', 'DAYNAME(date)'),
                'Hour': ('Hour of the day in HH:00 format', 'HOUR(commits[].date)', 'HOUR(date)'),
                'Commits': ('Number of commits made at this day/hour combination', 'COUNT(commits) grouped by userId', 'COUNT(*)')
            },
            'Commit Heatmap Yearly': {
                'Month': ('Month of the year', 'MONTHNAME(commits[].date)', 'MONTHNAME(date)'),
                'Commits': ('Number of commits made in this month', 'COUNT(commits) grouped by userId', 'COUNT(*)')
            },
            'Repository Summary': {
                'Repository_Name': ('Name of the repository in owner/repo format', 'groupedByRepository key', 'N/A'),
                'PR_Usage_Percentage': ('Percentage of commits made via PRs in this repo', 'pr_commits / total_commits * 100', '(pr/total)*100'),
                'Contributors_Count': ('Number of unique contributors to this repo', 'COUNT(DISTINCT(userId))', 'COUNT(UNIQUE(userIds))'),
                'Contributors': ('Semicolon-separated list of contributors', 'DISTINCT(commits[].userId)', 'TEXTJOIN(";",UNIQUE(userIds))')
            }
        }
        
        # Get documentation
        if column in common_docs:
            return common_docs[column]
        elif sheet_name in sheet_specific and column in sheet_specific[sheet_name]:
            return sheet_specific[sheet_name][column]
        else:
            # Generate generic documentation
            return (
                f'Data field from {sheet_name} worksheet',
                'Derived from commits[] or calculated metric with userId tracking',
                'N/A'
            )


def setup_argument_parser() -> argparse.ArgumentParser:
    """Setup command line argument parser"""
    parser = argparse.ArgumentParser(
        description='Developer Insights Excel Report Generator - Multi-agent system for analyzing GitHub developer activity',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python main.py --directory ./json_reports --filename insights_report
  python main.py --directory ./data --outputDir ./reports --verbose
  python main.py --directory ./output --ignore-pattern "*audit.json,*temp.json" --debug
  python main.py --directory ./data --export-json --json-indent 4
        """
    )
    
    parser.add_argument(
        '--directory',
        type=str,
        default='./output',
        help='Directory to search for JSON files (default: ./output)'
    )
    
    parser.add_argument(
        '--outputDir',
        type=str,
        default='./reports',
        help='Directory to save the Excel report (default: ./reports)'
    )
    
    parser.add_argument(
        '--filename',
        type=str,
        help='Base name for the output file (default: auto-generated with timestamp)'
    )
    
    parser.add_argument(
        '--ignore-pattern',
        type=str,
        default='*audit.json',
        help='Comma-separated glob patterns for files to ignore (default: *audit.json)'
    )
    
    parser.add_argument(
        '--verbose',
        action='store_true',
        help='Enable verbose logging'
    )
    
    parser.add_argument(
        '--debug',
        action='store_true',
        help='Enable debug logging and generate audit files'
    )
    
    parser.add_argument(
        '--export-json',
        action='store_true',
        default=False,
        help='Export worksheet data as JSON alongside Excel file'
    )
    
    parser.add_argument(
        '--json-indent',
        type=int,
        default=4,
        help='Indentation level for JSON output (default: 4)'
    )
    
    return parser


def main():
    """Main entry point"""
    parser = setup_argument_parser()
    args = parser.parse_args()
    
    # Validate arguments
    if args.json_indent < 0:
        print("⚠️  Warning: json-indent must be non-negative, using default value 4")
        args.json_indent = 4
    
    # Create and run the main application
    app = AllUserCommit()
    app.run(args)


if __name__ == '__main__':
    main()