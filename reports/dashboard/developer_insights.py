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


class DeveloperInsights:
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
                
            # Check for required fields (either new or old format)
            has_analytics = 'analytics' in data
            has_old_format = 'summary' in data or 'commits' in data
            
            if not has_analytics and not has_old_format:
                self.logger.warning(f"⚠️  File missing required structure: {file_path}")
                
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
        
        # Create different DataFrame views based on the new analytics structure
        dataframes['Dashboard'] = self._create_dashboard_summary(json_data_list)
        dataframes['Summary'] = self._create_summary_df(json_data_list)
        dataframes['PR_Throughput_Details'] = self._create_pr_throughput_df(json_data_list)
        dataframes['Code_Churn_Details'] = self._create_code_churn_df(json_data_list)
        dataframes['PR_Cycle_Time_Details'] = self._create_pr_cycle_time_df(json_data_list)
        dataframes['Work_Patterns_Day'] = self._create_work_patterns_day_df(json_data_list)
        dataframes['Work_Patterns_Hour'] = self._create_work_patterns_hour_df(json_data_list)
        dataframes['Work_Patterns_Analysis'] = self._create_work_patterns_analysis_df(json_data_list)
        dataframes['Inefficiency_Flags'] = self._create_inefficiency_flags_df(json_data_list)
        dataframes['JSON_Files_Loaded'] = self._create_files_loaded_df(json_data_list)
        
        self.logger.info(f"✅ Created {len(dataframes)} DataFrames")
        
        return dataframes
    
    def _create_dashboard_summary(self, json_data_list: List[Dict]) -> pd.DataFrame:
        """Create dashboard summary with KPI metrics"""
        dashboard_data = []
        
        for data in json_data_list:
            search_user = data.get('metadata', {}).get('searchUser', 'unknown')
            summary = data.get('summary', {})
            analytics = data.get('analytics', {})
            
            # Get analytics data
            pr_throughput = analytics.get('prThroughput', {})
            code_churn = analytics.get('codeChurn', {})
            work_patterns = analytics.get('workPatterns', {})
            pr_cycle_time = analytics.get('prCycleTime', {})
            
            row = {
                'searchUser': search_user,
                'source_file': data.get('_source_file', 'unknown'),
                'total_contributions': summary.get('totalContributions', 0),
                'total_commits': summary.get('totalCommits', 0),
                'total_prs_created': summary.get('totalPRsCreated', 0),
                'total_reviews_submitted': summary.get('totalReviewsSubmitted', 0),
                'lines_added': summary.get('linesAdded', 0),
                'lines_deleted': summary.get('linesDeleted', 0),
                'merge_rate_percent': pr_throughput.get('mergeRate', 0),
                'avg_cycle_time_days': pr_cycle_time.get('avgCycleTime', 0),
                'after_hours_percentage': work_patterns.get('afterHoursPercentage', 0),
                'most_active_day': work_patterns.get('mostActiveDay', 'Unknown'),
                'repositories_analyzed': len(data.get('metadata', {}).get('repositoriesAnalyzed', []))
            }
            
            # Add meta tags
            meta_tags = data.get('metadata', {}).get('metaTags', {})
            for key, value in meta_tags.items():
                row[f'meta_{key}'] = value
            
            dashboard_data.append(row)
        
        return pd.DataFrame(dashboard_data)
    
    def _create_summary_df(self, json_data_list: List[Dict]) -> pd.DataFrame:
        """Create summary DataFrame from summary objects"""
        summary_data = []
        
        for data in json_data_list:
            search_user = data.get('metadata', {}).get('searchUser', 'unknown')
            summary = data.get('summary', {})
            
            row = {
                'searchUser': search_user,
                'source_file': data.get('_source_file', 'unknown'),
                'total_contributions': summary.get('totalContributions', 0),
                'total_commits': summary.get('totalCommits', 0),
                'total_prs_created': summary.get('totalPRsCreated', 0),
                'total_reviews_submitted': summary.get('totalReviewsSubmitted', 0),
                'total_comments': summary.get('totalComments', 0),
                'lines_added': summary.get('linesAdded', 0),
                'lines_deleted': summary.get('linesDeleted', 0),
                'primary_languages': '; '.join(summary.get('primaryLanguages', []))
            }
            
            # Add meta tags
            meta_tags = data.get('metadata', {}).get('metaTags', {})
            for key, value in meta_tags.items():
                row[f'meta_{key}'] = value
            
            summary_data.append(row)
        
        return pd.DataFrame(summary_data)
    
    def _create_pr_throughput_df(self, json_data_list: List[Dict]) -> pd.DataFrame:
        """Create PR throughput details DataFrame"""
        pr_data = []
        
        for data in json_data_list:
            search_user = data.get('metadata', {}).get('searchUser', 'unknown')
            pr_throughput = data.get('analytics', {}).get('prThroughput', {})
            
            # Get PR details
            for pr_detail in pr_throughput.get('details', []):
                row = {
                    'searchUser': search_user,
                    'source_file': data.get('_source_file', 'unknown'),
                    'number': pr_detail.get('number'),
                    'title': pr_detail.get('title', ''),
                    'repository': pr_detail.get('repository', ''),
                    'state': pr_detail.get('state', ''),
                    'created_at': pr_detail.get('created_at'),
                    'merged_at': pr_detail.get('merged_at'),
                    'closed_at': pr_detail.get('closed_at'),
                    'additions': pr_detail.get('additions', 0),
                    'deletions': pr_detail.get('deletions', 0),
                    'changed_files': pr_detail.get('changed_files', 0),
                    'total_changes': pr_detail.get('additions', 0) + pr_detail.get('deletions', 0)
                }
                
                # Calculate cycle time
                if pr_detail.get('created_at') and pr_detail.get('merged_at'):
                    created = self._parse_date(pr_detail['created_at'])
                    merged = self._parse_date(pr_detail['merged_at'])
                    if created and merged:
                        cycle_time = (merged - created).total_seconds() / (24 * 3600)  # days
                        row['cycle_time_days'] = round(cycle_time, 2)
                    else:
                        row['cycle_time_days'] = None
                else:
                    row['cycle_time_days'] = None
                
                # Add meta tags
                meta_tags = data.get('metadata', {}).get('metaTags', {})
                for key, value in meta_tags.items():
                    row[f'meta_{key}'] = value
                
                pr_data.append(row)
        
        return pd.DataFrame(pr_data)
    
    def _create_code_churn_df(self, json_data_list: List[Dict]) -> pd.DataFrame:
        """Create code churn details DataFrame"""
        commit_data = []
        
        for data in json_data_list:
            search_user = data.get('metadata', {}).get('searchUser', 'unknown')
            code_churn = data.get('analytics', {}).get('codeChurn', {})
            
            # Get commit details
            for commit_detail in code_churn.get('details', []):
                author_info = commit_detail.get('author', {})
                stats_info = commit_detail.get('stats', {})
                
                row = {
                    'searchUser': search_user,
                    'source_file': data.get('_source_file', 'unknown'),
                    'sha': commit_detail.get('sha', ''),
                    'message': commit_detail.get('message', ''),
                    'repository': commit_detail.get('repository', ''),
                    'author_name': author_info.get('name', ''),
                    'author_email': author_info.get('email', ''),
                    'author_date': author_info.get('date'),
                    'stats_total': stats_info.get('total', 0),
                    'stats_additions': stats_info.get('additions', 0),
                    'stats_deletions': stats_info.get('deletions', 0)
                }
                
                # Add meta tags
                meta_tags = data.get('metadata', {}).get('metaTags', {})
                for key, value in meta_tags.items():
                    row[f'meta_{key}'] = value
                
                commit_data.append(row)
        
        return pd.DataFrame(commit_data)
    
    def _create_pr_cycle_time_df(self, json_data_list: List[Dict]) -> pd.DataFrame:
        """Create PR cycle time details DataFrame"""
        cycle_data = []
        
        for data in json_data_list:
            search_user = data.get('metadata', {}).get('searchUser', 'unknown')
            pr_cycle_time = data.get('analytics', {}).get('prCycleTime', {})
            
            # Get PR cycle time details
            for pr_detail in pr_cycle_time.get('details', []):
                row = {
                    'searchUser': search_user,
                    'source_file': data.get('_source_file', 'unknown'),
                    'number': pr_detail.get('number'),
                    'title': pr_detail.get('title', ''),
                    'repository': pr_detail.get('repository', ''),
                    'created_at': pr_detail.get('created_at'),
                    'merged_at': pr_detail.get('merged_at'),
                    'closed_at': pr_detail.get('closed_at'),
                    'cycle_time': pr_detail.get('cycleTime'),
                    'status': pr_detail.get('status', '')
                }
                
                # Add meta tags
                meta_tags = data.get('metadata', {}).get('metaTags', {})
                for key, value in meta_tags.items():
                    row[f'meta_{key}'] = value
                
                cycle_data.append(row)
        
        return pd.DataFrame(cycle_data)
    
    def _create_work_patterns_day_df(self, json_data_list: List[Dict]) -> pd.DataFrame:
        """Create work patterns day distribution DataFrame"""
        day_data = []
        
        for data in json_data_list:
            search_user = data.get('metadata', {}).get('searchUser', 'unknown')
            work_patterns = data.get('analytics', {}).get('workPatterns', {})
            day_distribution = work_patterns.get('dayDistribution', {})
            
            for day, activity_count in day_distribution.items():
                row = {
                    'searchUser': search_user,
                    'source_file': data.get('_source_file', 'unknown'),
                    'day': day,
                    'activity_count': activity_count
                }
                
                # Add meta tags
                meta_tags = data.get('metadata', {}).get('metaTags', {})
                for key, value in meta_tags.items():
                    row[f'meta_{key}'] = value
                
                day_data.append(row)
        
        return pd.DataFrame(day_data)
    
    def _create_work_patterns_hour_df(self, json_data_list: List[Dict]) -> pd.DataFrame:
        """Create work patterns hour distribution DataFrame"""
        hour_data = []
        
        for data in json_data_list:
            search_user = data.get('metadata', {}).get('searchUser', 'unknown')
            work_patterns = data.get('analytics', {}).get('workPatterns', {})
            hour_distribution = work_patterns.get('hourDistribution', {})
            
            for hour, activity_count in hour_distribution.items():
                row = {
                    'searchUser': search_user,
                    'source_file': data.get('_source_file', 'unknown'),
                    'hour_utc': int(hour),
                    'activity_count': activity_count,
                    'is_after_hours': 1 if int(hour) < 8 or int(hour) > 18 else 0
                }
                
                # Add meta tags
                meta_tags = data.get('metadata', {}).get('metaTags', {})
                for key, value in meta_tags.items():
                    row[f'meta_{key}'] = value
                
                hour_data.append(row)
        
        return pd.DataFrame(hour_data)
    
    def _create_work_patterns_analysis_df(self, json_data_list: List[Dict]) -> pd.DataFrame:
        """Create work patterns analysis DataFrame"""
        analysis_data = []
        
        for data in json_data_list:
            search_user = data.get('metadata', {}).get('searchUser', 'unknown')
            work_patterns = data.get('analytics', {}).get('workPatterns', {})
            
            row = {
                'searchUser': search_user,
                'source_file': data.get('_source_file', 'unknown'),
                'most_active_day': work_patterns.get('mostActiveDay', 'Unknown'),
                'after_hours_percentage': work_patterns.get('afterHoursPercentage', 0),
                'total_activities': work_patterns.get('totalActivities', 0),
                'after_hours_count': work_patterns.get('afterHoursCount', 0)
            }
            
            # Add meta tags
            meta_tags = data.get('metadata', {}).get('metaTags', {})
            for key, value in meta_tags.items():
                row[f'meta_{key}'] = value
            
            analysis_data.append(row)
        
        return pd.DataFrame(analysis_data)
    
    def _create_inefficiency_flags_df(self, json_data_list: List[Dict]) -> pd.DataFrame:
        """Create inefficiency flags DataFrame based on enhancement requirements"""
        flag_data = []
        
        for data in json_data_list:
            search_user = data.get('metadata', {}).get('searchUser', 'unknown')
            summary = data.get('summary', {})
            analytics = data.get('analytics', {})
            
            # Get analytics data
            pr_throughput = analytics.get('prThroughput', {})
            pr_cycle_time = analytics.get('prCycleTime', {})
            work_patterns = analytics.get('workPatterns', {})
            
            # Extract key metrics
            merge_rate = pr_throughput.get('mergeRate', 0)
            reviews_given = summary.get('totalReviewsSubmitted', 0)
            avg_cycle_time = pr_cycle_time.get('avgCycleTime', 0)
            after_hours_pct = work_patterns.get('afterHoursPercentage', 0)
            
            # Determine flags based on enhancement requirements
            merge_rate_flag = 'Yellow' if merge_rate < 80 else 'Green'
            reviews_flag = 'Red' if reviews_given == 0 else 'Green'
            cycle_time_flag = 'Yellow' if avg_cycle_time > 5 else 'Green'
            
            if after_hours_pct > 50:
                after_hours_flag = 'Red'
            elif after_hours_pct > 25:
                after_hours_flag = 'Yellow'
            else:
                after_hours_flag = 'Green'
            
            # Overall risk level
            red_flags = sum([
                1 for flag in [merge_rate_flag, reviews_flag, cycle_time_flag, after_hours_flag]
                if flag == 'Red'
            ])
            yellow_flags = sum([
                1 for flag in [merge_rate_flag, reviews_flag, cycle_time_flag, after_hours_flag]
                if flag == 'Yellow'
            ])
            
            if red_flags > 0:
                overall_risk = 'High'
            elif yellow_flags > 1:
                overall_risk = 'Medium'
            elif yellow_flags == 1:
                overall_risk = 'Low'
            else:
                overall_risk = 'None'
            
            row = {
                'searchUser': search_user,
                'source_file': data.get('_source_file', 'unknown'),
                'merge_rate_percent': merge_rate,
                'merge_rate_flag': merge_rate_flag,
                'reviews_given': reviews_given,
                'reviews_flag': reviews_flag,
                'avg_cycle_time_days': avg_cycle_time,
                'cycle_time_flag': cycle_time_flag,
                'after_hours_percentage': after_hours_pct,
                'after_hours_flag': after_hours_flag,
                'overall_risk_level': overall_risk,
                'total_flags': red_flags + yellow_flags
            }
            
            # Add meta tags
            meta_tags = data.get('metadata', {}).get('metaTags', {})
            for key, value in meta_tags.items():
                row[f'meta_{key}'] = value
            
            flag_data.append(row)
        
        return pd.DataFrame(flag_data)
    
    def _create_files_loaded_df(self, json_data_list: List[Dict]) -> pd.DataFrame:
        """Create JSON files loaded tracking DataFrame"""
        files_data = []
        
        for data in json_data_list:
            row = {
                'file_name': data.get('_source_file', 'unknown'),
                'file_path': data.get('_source_path', 'unknown'),
                'successfully_parsed': True,
                'has_analytics': 'analytics' in data,
                'has_summary': 'summary' in data,
                'search_user': data.get('metadata', {}).get('searchUser', 'unknown'),
                'generated_at': data.get('metadata', {}).get('generatedAt', ''),
                'report_version': data.get('metadata', {}).get('reportVersion', ''),
                'enabled_modules': '; '.join(data.get('metadata', {}).get('enabledModules', []))
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
            # Create dashboard first (visual summary)
            self._create_executive_dashboard(dataframes, json_data)
            
            # Create data sheets with conditional formatting
            for sheet_name, df in dataframes.items():
                if sheet_name != 'Dashboard':  # Skip dashboard since we created it separately
                    self._create_data_sheet(sheet_name, df)
            
            # Create Data Dictionary last (most important)
            self._create_data_dictionary(dataframes)
            
            self.logger.info("✅ Excel workbook created successfully")
            
        finally:
            self.workbook.close()
        
        # Export to JSON if enabled
        if self.export_json:
            json_path = self._export_worksheets_to_json(dataframes, output_path)
            if json_path:
                self.logger.info(f"📄 JSON export completed: {json_path}")
    
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
            
            # Risk indicators with clear contrast
            'risk_high': self.workbook.add_format({
                'bg_color': '#FF6B6B',  # Soft red - High risk
                'font_color': '#2C3E50',  # Dark blue-gray
                'border': 1
            }),
            'risk_medium': self.workbook.add_format({
                'bg_color': '#FFB366',  # Soft orange - Medium risk
                'font_color': '#2C3E50',  # Dark blue-gray
                'border': 1
            }),
            'risk_low': self.workbook.add_format({
                'bg_color': '#D4A574',  # Soft brown - Low input levels
                'font_color': '#2C3E50',  # Dark blue-gray
                'border': 1
            }),
            'warning': self.workbook.add_format({
                'bg_color': '#FFE066',  # Soft yellow - Warning
                'font_color': '#2C3E50',  # Dark blue-gray
                'border': 1
            }),
            'good': self.workbook.add_format({
                'bg_color': '#90EE90',  # Light green - Good
                'font_color': '#2C3E50',  # Dark blue-gray
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
    
    def _create_executive_dashboard(self, dataframes: Dict[str, pd.DataFrame], 
                                  json_data: List[Dict]) -> None:
        """Create executive dashboard with visual summary"""
        worksheet = self.workbook.add_worksheet('Dashboard')
        
        row = 0
        
        # Title
        worksheet.merge_range(row, 0, row, 7, 'Developer Insights Dashboard', 
                            self.formats['header'])
        worksheet.set_row(row, 30)
        row += 2
        
        # KPIs Section
        worksheet.write(row, 0, 'Key Performance Indicators', self.formats['subheader'])
        row += 1
        
        # Calculate aggregate KPIs from Dashboard DataFrame
        if 'Dashboard' in dataframes and not dataframes['Dashboard'].empty:
            dashboard_df = dataframes['Dashboard']
            
            kpi_metrics = [
                ('Total Contributors', len(dashboard_df)),
                ('Total Commits', dashboard_df['total_commits'].sum()),
                ('Total Pull Requests', dashboard_df['total_prs_created'].sum()),
                ('Total Code Lines Added', dashboard_df['lines_added'].sum()),
                ('Total Code Lines Deleted', dashboard_df['lines_deleted'].sum()),
                ('Average Merge Rate %', round(dashboard_df['merge_rate_percent'].mean(), 1)),
                ('Average After-Hours %', round(dashboard_df['after_hours_percentage'].mean(), 1))
            ]
            
            for label, value in kpi_metrics:
                worksheet.write(row, 0, label, self.formats['bold'])
                worksheet.write(row, 1, value, self.formats['number'])
                row += 1
        
        row += 1
        
        # Risk Analysis Section
        worksheet.write(row, 0, 'Risk & Quality Indicators', self.formats['subheader'])
        row += 1
        
        if 'Inefficiency_Flags' in dataframes and not dataframes['Inefficiency_Flags'].empty:
            flags_df = dataframes['Inefficiency_Flags']
            
            # Count risk levels
            high_risk = (flags_df['overall_risk_level'] == 'High').sum()
            medium_risk = (flags_df['overall_risk_level'] == 'Medium').sum()
            low_risk = (flags_df['overall_risk_level'] == 'Low').sum()
            no_risk = (flags_df['overall_risk_level'] == 'None').sum()
            
            # Individual flag counts
            merge_rate_issues = (flags_df['merge_rate_flag'] != 'Green').sum()
            review_issues = (flags_df['reviews_flag'] == 'Red').sum()
            cycle_time_issues = (flags_df['cycle_time_flag'] != 'Green').sum()
            after_hours_issues = (flags_df['after_hours_flag'] != 'Green').sum()
            
            risk_metrics = [
                ('Contributors with High Risk', high_risk, 'risk_high' if high_risk > 0 else 'good'),
                ('Contributors with Medium Risk', medium_risk, 'risk_medium' if medium_risk > 0 else 'good'),
                ('Contributors with Low Risk', low_risk, 'warning' if low_risk > 0 else 'good'),
                ('Contributors with No Risk', no_risk, 'good'),
                ('Low Merge Rate Issues (<80%)', merge_rate_issues, 'warning' if merge_rate_issues > 0 else 'good'),
                ('No Code Reviews Given', review_issues, 'risk_high' if review_issues > 0 else 'good'),
                ('Long PR Cycle Times (>5 days)', cycle_time_issues, 'warning' if cycle_time_issues > 0 else 'good'),
                ('High After-Hours Work (>25%)', after_hours_issues, 'warning' if after_hours_issues > 0 else 'good')
            ]
            
            for label, count, format_key in risk_metrics:
                worksheet.write(row, 0, label, self.formats['bold'])
                worksheet.write(row, 1, count, self.formats['number'])
                worksheet.write(row, 2, 'FLAGGED' if count > 0 else 'OK', self.formats[format_key])
                row += 1
        
        row += 2
        
        # Files processed section
        worksheet.write(row, 0, 'Data Sources', self.formats['subheader'])
        row += 1
        
        worksheet.write(row, 0, 'JSON Files Processed', self.formats['bold'])
        worksheet.write(row, 1, len(json_data), self.formats['number'])
        row += 1
        
        # List source files
        for i, data in enumerate(json_data[:10], 1):  # Show first 10 files
            file_name = data.get('_source_file', f'File {i}')
            search_user = data.get('metadata', {}).get('searchUser', 'unknown')
            worksheet.write(row, 0, f"{i}. {file_name}")
            worksheet.write(row, 1, f"User: {search_user}")
            row += 1
        
        if len(json_data) > 10:
            worksheet.write(row, 0, f"... and {len(json_data) - 10} more files")
            row += 1
        
        # Auto-adjust column widths
        worksheet.set_column(0, 0, 35)  # Labels
        worksheet.set_column(1, 1, 20)  # Values
        worksheet.set_column(2, 2, 15)  # Status
    
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
        
        # Apply conditional formatting based on enhancement requirements
        self._apply_inefficiency_formatting(worksheet, sheet_name, df)
        
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
    
    def _apply_inefficiency_formatting(self, worksheet, sheet_name: str, df: pd.DataFrame) -> None:
        """Apply conditional formatting rules based on inefficiency indicators"""
        if df.empty:
            return
            
        data_rows = len(df)
        
        # Apply formatting based on enhancement requirements
        if sheet_name == 'Inefficiency_Flags':
            self._format_inefficiency_flags_sheet(worksheet, df, data_rows)
        elif sheet_name == 'PR_Throughput_Details':
            self._format_pr_throughput_sheet(worksheet, df, data_rows)
        elif sheet_name == 'PR_Cycle_Time_Details':
            self._format_cycle_time_sheet(worksheet, df, data_rows)
        elif sheet_name == 'Work_Patterns_Analysis':
            self._format_work_patterns_sheet(worksheet, df, data_rows)
        elif sheet_name == 'Summary':
            self._format_summary_sheet(worksheet, df, data_rows)
    
    def _format_inefficiency_flags_sheet(self, worksheet, df: pd.DataFrame, data_rows: int) -> None:
        """Format the Inefficiency_Flags sheet with color coding"""
        # Format flag columns based on their values
        flag_columns = ['merge_rate_flag', 'reviews_flag', 'cycle_time_flag', 'after_hours_flag', 'overall_risk_level']
        
        for column in flag_columns:
            if column in df.columns:
                col_idx = df.columns.get_loc(column)
                col_letter = xl_col_to_name(col_idx)
                
                # Red flags
                worksheet.conditional_format(
                    f'{col_letter}2:{col_letter}{data_rows + 1}',
                    {
                        'type': 'text',
                        'criteria': 'containing',
                        'value': 'Red',
                        'format': self.formats['risk_high']
                    }
                )
                
                # High risk
                worksheet.conditional_format(
                    f'{col_letter}2:{col_letter}{data_rows + 1}',
                    {
                        'type': 'text',
                        'criteria': 'containing',
                        'value': 'High',
                        'format': self.formats['risk_high']
                    }
                )
                
                # Yellow/Medium flags
                worksheet.conditional_format(
                    f'{col_letter}2:{col_letter}{data_rows + 1}',
                    {
                        'type': 'text',
                        'criteria': 'containing',
                        'value': 'Yellow',
                        'format': self.formats['warning']
                    }
                )
                
                worksheet.conditional_format(
                    f'{col_letter}2:{col_letter}{data_rows + 1}',
                    {
                        'type': 'text',
                        'criteria': 'containing',
                        'value': 'Medium',
                        'format': self.formats['warning']
                    }
                )
                
                # Green flags
                worksheet.conditional_format(
                    f'{col_letter}2:{col_letter}{data_rows + 1}',
                    {
                        'type': 'text',
                        'criteria': 'containing',
                        'value': 'Green',
                        'format': self.formats['good']
                    }
                )
        
        # Format numerical columns based on thresholds
        if 'merge_rate_percent' in df.columns:
            col_idx = df.columns.get_loc('merge_rate_percent')
            col_letter = xl_col_to_name(col_idx)
            
            # Merge rate < 80% = Yellow
            worksheet.conditional_format(
                f'{col_letter}2:{col_letter}{data_rows + 1}',
                {
                    'type': 'cell',
                    'criteria': '<',
                    'value': 80,
                    'format': self.formats['warning']
                }
            )
        
        if 'reviews_given' in df.columns:
            col_idx = df.columns.get_loc('reviews_given')
            col_letter = xl_col_to_name(col_idx)
            
            # Reviews given = 0 = Red
            worksheet.conditional_format(
                f'{col_letter}2:{col_letter}{data_rows + 1}',
                {
                    'type': 'cell',
                    'criteria': '=',
                    'value': 0,
                    'format': self.formats['risk_high']
                }
            )
        
        if 'avg_cycle_time_days' in df.columns:
            col_idx = df.columns.get_loc('avg_cycle_time_days')
            col_letter = xl_col_to_name(col_idx)
            
            # Cycle time > 5 days = Yellow
            worksheet.conditional_format(
                f'{col_letter}2:{col_letter}{data_rows + 1}',
                {
                    'type': 'cell',
                    'criteria': '>',
                    'value': 5,
                    'format': self.formats['warning']
                }
            )
        
        if 'after_hours_percentage' in df.columns:
            col_idx = df.columns.get_loc('after_hours_percentage')
            col_letter = xl_col_to_name(col_idx)
            
            # After hours > 50% = Red
            worksheet.conditional_format(
                f'{col_letter}2:{col_letter}{data_rows + 1}',
                {
                    'type': 'cell',
                    'criteria': '>',
                    'value': 50,
                    'format': self.formats['risk_high']
                }
            )
            
            # After hours > 25% = Yellow
            worksheet.conditional_format(
                f'{col_letter}2:{col_letter}{data_rows + 1}',
                {
                    'type': 'cell',
                    'criteria': 'between',
                    'minimum': 25,
                    'maximum': 50,
                    'format': self.formats['warning']
                }
            )
    
    def _format_pr_throughput_sheet(self, worksheet, df: pd.DataFrame, data_rows: int) -> None:
        """Format PR throughput sheet"""
        # Large PRs highlighting
        if 'total_changes' in df.columns:
            col_idx = df.columns.get_loc('total_changes')
            col_letter = xl_col_to_name(col_idx)
            
            # Very large PRs (>1000 lines)
            worksheet.conditional_format(
                f'{col_letter}2:{col_letter}{data_rows + 1}',
                {
                    'type': 'cell',
                    'criteria': '>=',
                    'value': 1000,
                    'format': self.formats['risk_high']
                }
            )
            
            # Large PRs (500-1000 lines)
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
    
    def _format_cycle_time_sheet(self, worksheet, df: pd.DataFrame, data_rows: int) -> None:
        """Format cycle time sheet"""
        if 'cycle_time' in df.columns:
            col_idx = df.columns.get_loc('cycle_time')
            col_letter = xl_col_to_name(col_idx)
            
            # Long cycle times (>10 days)
            worksheet.conditional_format(
                f'{col_letter}2:{col_letter}{data_rows + 1}',
                {
                    'type': 'cell',
                    'criteria': '>',
                    'value': 10,
                    'format': self.formats['risk_high']
                }
            )
            
            # Medium cycle times (5-10 days)
            worksheet.conditional_format(
                f'{col_letter}2:{col_letter}{data_rows + 1}',
                {
                    'type': 'cell',
                    'criteria': 'between',
                    'minimum': 5,
                    'maximum': 10,
                    'format': self.formats['warning']
                }
            )
    
    def _format_work_patterns_sheet(self, worksheet, df: pd.DataFrame, data_rows: int) -> None:
        """Format work patterns sheet"""
        if 'after_hours_percentage' in df.columns:
            col_idx = df.columns.get_loc('after_hours_percentage')
            col_letter = xl_col_to_name(col_idx)
            
            # High after-hours work (>50%)
            worksheet.conditional_format(
                f'{col_letter}2:{col_letter}{data_rows + 1}',
                {
                    'type': 'cell',
                    'criteria': '>',
                    'value': 50,
                    'format': self.formats['risk_high']
                }
            )
            
            # Medium after-hours work (25-50%)
            worksheet.conditional_format(
                f'{col_letter}2:{col_letter}{data_rows + 1}',
                {
                    'type': 'cell',
                    'criteria': 'between',
                    'minimum': 25,
                    'maximum': 50,
                    'format': self.formats['warning']
                }
            )
    
    def _format_summary_sheet(self, worksheet, df: pd.DataFrame, data_rows: int) -> None:
        """Format summary sheet"""
        if 'total_reviews_submitted' in df.columns:
            col_idx = df.columns.get_loc('total_reviews_submitted')
            col_letter = xl_col_to_name(col_idx)
            
            # No reviews given = Red
            worksheet.conditional_format(
                f'{col_letter}2:{col_letter}{data_rows + 1}',
                {
                    'type': 'cell',
                    'criteria': '=',
                    'value': 0,
                    'format': self.formats['risk_high']
                }
            )
    
    def _create_data_dictionary(self, dataframes: Dict[str, pd.DataFrame]) -> None:
        """Create comprehensive data dictionary worksheet"""
        worksheet = self.workbook.add_worksheet('Data_Dictionary')
        
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
        
        # Add enhancement requirements explanation
        row += 2
        worksheet.write(row, 0, 'Enhancement Requirements (Inefficiency Flags)', self.formats['subheader'])
        row += 1
        
        enhancement_rules = [
            "Merge Rate < 80%: Flagged Yellow (warning for low PR merge success)",
            "Reviews Given == 0: Flagged Red (high risk for no code review participation)",
            "Avg PR Cycle Time > 5 days: Flagged Yellow (warning for slow PR cycles)",
            "After Hours > 25%: Flagged Yellow (warning for work-life balance issues)",
            "After Hours > 50%: Flagged Red (high risk for burnout)",
            "",
            "Color Coding:",
            "- Red: High risk requiring immediate attention",
            "- Yellow: Warning indicators requiring monitoring",
            "- Green: Good indicators showing healthy patterns",
            "",
            "Data Sources:",
            "- analytics.prThroughput: Pull request throughput analysis",
            "- analytics.codeChurn: Code changes and commit analysis", 
            "- analytics.workPatterns: Work timing and pattern analysis",
            "- analytics.prCycleTime: Pull request cycle time analysis",
            "- summary: High-level contribution metrics",
            "- metadata: Report generation and user information"
        ]
        
        for explanation in enhancement_rules:
            worksheet.write(row, 0, explanation)
            row += 1
        
        # Auto-adjust column widths
        worksheet.set_column(0, 0, 25)  # Worksheet Name
        worksheet.set_column(1, 1, 30)  # Column Name
        worksheet.set_column(2, 2, 70)  # Value Description
        worksheet.set_column(3, 3, 50)  # Source / Criteria
        worksheet.set_column(4, 4, 30)  # Formula
    
    def _get_column_documentation(self, sheet_name: str, column: str) -> Tuple[str, str, str]:
        """Get documentation for a specific column based on OpenAPI schema"""
        
        # Common column documentation based on OpenAPI schema
        common_docs = {
            'searchUser': ('User ID or search term used to filter the data', 'metadata.searchUser', 'N/A'),
            'source_file': ('Name of the JSON file this data was extracted from', 'Generated during processing', 'N/A'),
            'total_contributions': ('Total number of contributions by this user', 'summary.totalContributions', 'N/A'),
            'total_commits': ('Total number of commits made by this user', 'summary.totalCommits', 'N/A'),
            'total_prs_created': ('Total number of pull requests created by this user', 'summary.totalPRsCreated', 'N/A'),
            'total_reviews_submitted': ('Total number of code reviews submitted by this user', 'summary.totalReviewsSubmitted', 'N/A'),
            'lines_added': ('Total lines of code added by this user', 'summary.linesAdded', 'N/A'),
            'lines_deleted': ('Total lines of code deleted by this user', 'summary.linesDeleted', 'N/A'),
            'merge_rate_percent': ('Percentage of pull requests that were successfully merged', 'analytics.prThroughput.mergeRate', '(merged PRs / total PRs) * 100'),
            'avg_cycle_time_days': ('Average time in days from PR creation to merge', 'analytics.prCycleTime.avgCycleTime', 'Sum(cycle times) / Count(merged PRs)'),
            'after_hours_percentage': ('Percentage of activities performed outside business hours', 'analytics.workPatterns.afterHoursPercentage', '(after hours activities / total activities) * 100'),
            'number': ('Pull request number', 'analytics.prThroughput.details[].number', 'N/A'),
            'title': ('Title of the pull request or item', 'analytics.prThroughput.details[].title', 'N/A'),
            'repository': ('Name of the repository in owner/repo format', 'analytics.prThroughput.details[].repository', 'N/A'),
            'state': ('Current state of the pull request (open, closed, merged)', 'analytics.prThroughput.details[].state', 'N/A'),
            'created_at': ('Date and time when the item was created', 'analytics.prThroughput.details[].created_at', 'N/A'),
            'merged_at': ('Date and time when the pull request was merged', 'analytics.prThroughput.details[].merged_at', 'N/A'),
            'closed_at': ('Date and time when the pull request was closed', 'analytics.prThroughput.details[].closed_at', 'N/A'),
            'additions': ('Number of lines added in this change', 'analytics.prThroughput.details[].additions', 'N/A'),
            'deletions': ('Number of lines deleted in this change', 'analytics.prThroughput.details[].deletions', 'N/A'),
            'changed_files': ('Number of files modified in this change', 'analytics.prThroughput.details[].changed_files', 'N/A'),
            'sha': ('Unique SHA hash identifier for the commit', 'analytics.codeChurn.details[].sha', 'N/A'),
            'message': ('Commit message describing the changes', 'analytics.codeChurn.details[].message', 'N/A'),
            'author_name': ('Name of the commit author', 'analytics.codeChurn.details[].author.name', 'N/A'),
            'author_email': ('Email address of the commit author', 'analytics.codeChurn.details[].author.email', 'N/A'),
            'author_date': ('Date when the commit was authored', 'analytics.codeChurn.details[].author.date', 'N/A'),
            'cycle_time': ('Time in days from PR creation to merge/close', 'analytics.prCycleTime.details[].cycleTime', 'N/A'),
            'status': ('Status of the pull request (merged, closed, open)', 'analytics.prCycleTime.details[].status', 'N/A'),
            'day': ('Day of the week', 'analytics.workPatterns.dayDistribution keys', 'N/A'),
            'activity_count': ('Number of activities on this day/hour', 'analytics.workPatterns.dayDistribution values', 'N/A'),
            'hour_utc': ('Hour of the day in UTC (0-23)', 'analytics.workPatterns.hourDistribution keys', 'N/A'),
            'most_active_day': ('Day of the week with highest activity', 'analytics.workPatterns.mostActiveDay', 'N/A'),
            'total_activities': ('Total number of activities tracked', 'analytics.workPatterns.totalActivities', 'N/A'),
            'after_hours_count': ('Number of activities performed after hours', 'analytics.workPatterns.afterHoursCount', 'N/A'),
        }
        
        # Sheet-specific documentation
        sheet_specific = {
            'Inefficiency_Flags': {
                'merge_rate_flag': ('Flag color based on merge rate threshold (<80% = Yellow)', 'Calculated from merge_rate_percent', 'IF(merge_rate < 80, "Yellow", "Green")'),
                'reviews_flag': ('Flag color based on reviews given (0 = Red)', 'Calculated from reviews_given', 'IF(reviews = 0, "Red", "Green")'),
                'cycle_time_flag': ('Flag color based on cycle time (>5 days = Yellow)', 'Calculated from avg_cycle_time', 'IF(cycle_time > 5, "Yellow", "Green")'),
                'after_hours_flag': ('Flag color based on after-hours work (>25% = Yellow, >50% = Red)', 'Calculated from after_hours_percentage', 'IF(>50, "Red", IF(>25, "Yellow", "Green"))'),
                'overall_risk_level': ('Overall risk assessment (High/Medium/Low/None)', 'Calculated from all flags', 'Based on Red and Yellow flag counts'),
                'total_flags': ('Total number of warning/risk flags for this user', 'Sum of all non-green flags', 'COUNT(flags != "Green")')
            },
            'JSON_Files_Loaded': {
                'file_name': ('Name of the processed JSON file', 'File system', 'N/A'),
                'file_path': ('Full path to the processed JSON file', 'File system', 'N/A'),
                'successfully_parsed': ('Whether the file was successfully parsed', 'Processing result', 'N/A'),
                'has_analytics': ('Whether the file contains analytics section', 'File structure check', 'N/A'),
                'has_summary': ('Whether the file contains summary section', 'File structure check', 'N/A'),
                'generated_at': ('When the original report was generated', 'metadata.generatedAt', 'N/A'),
                'report_version': ('Version of the report format', 'metadata.reportVersion', 'N/A'),
                'enabled_modules': ('List of analysis modules that were enabled', 'metadata.enabledModules', 'N/A')
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
                f'Data field from {sheet_name} worksheet based on developer insights analytics',
                'Derived from analytics data or calculated metric',
                'N/A'
            )
    
    def _export_worksheets_to_json(self, dataframes: Dict[str, pd.DataFrame], 
                                   excel_path: str) -> Optional[str]:
        """Export all worksheets data to JSON format"""
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
                    export_data["worksheets"][sheet_name] = {
                        "headers": [],
                        "data": [],
                        "row_count": 0,
                        "column_count": 0,
                        "note": "Empty worksheet"
                    }
                    continue
                    
                # Convert DataFrame to JSON-serializable format
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
                            row_data.append(str(value))
                    data.append(row_data)
                
                export_data["worksheets"][sheet_name] = {
                    "headers": headers,
                    "data": data,
                    "row_count": len(data),
                    "column_count": len(headers)
                }
            
            # Write JSON file
            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump(export_data, f, indent=self.json_indent, ensure_ascii=False)
            
            return json_path
            
        except Exception as e:
            self.logger.error(f"❌ Failed to export JSON: {str(e)}")
            return None


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
        help='Enable debug logging'
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
    app = DeveloperInsights()
    app.run(args)


if __name__ == '__main__':
    main()