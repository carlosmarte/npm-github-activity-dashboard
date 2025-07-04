#!/usr/bin/env python3
"""
Developer Insights Excel Report Generator

A multi-agent CLI tool that processes developer activity JSON reports and generates
a structured Excel report highlighting team inefficiencies with comprehensive documentation.

Usage:
    python main.py --directory /path/to/json/files --outputDir /path/to/output --filename report
    python main.py --directory ./output --outputDir ./reports --filename team_insights --debug
"""

import argparse
import json
import os
import sys
from datetime import datetime
from glob import glob
from typing import Dict, List, Any, Optional, Tuple
import pandas as pd
import xlsxwriter
from xlsxwriter.format import Format


class OrchestratorCLI:
    """Command Layer - Manages CLI arguments and workflow orchestration."""
    
    def __init__(self):
        self.parser = self._setup_parser()
        self.verbose = False
        self.debug = False
        
    def _setup_parser(self) -> argparse.ArgumentParser:
        """Setup command line argument parser."""
        parser = argparse.ArgumentParser(
            description="Generate Excel reports from developer activity JSON files",
            formatter_class=argparse.RawDescriptionHelpFormatter,
            epilog="""
Examples:
    %(prog)s --directory ./output --outputDir ./reports --filename team_insights
    %(prog)s --directory /path/to/json --outputDir /path/to/output --filename report --debug
    %(prog)s --directory . --outputDir ./output --filename insights --ignore-pattern "*audit.json"
            """
        )
        
        parser.add_argument(
            '--directory',
            default='./output',
            help='Directory to search files (defaults to ./output)'
        )
        
        parser.add_argument(
            '--outputDir',
            default='./output',
            help='Directory to save files (defaults to ./output)'
        )
        
        parser.add_argument(
            '--filename',
            required=True,
            help='Base name for the output file(s)'
        )
        
        parser.add_argument(
            '--ignore-pattern',
            default='*audit.json',
            help='Glob pattern files to ignore during directory search'
        )
        
        parser.add_argument(
            '--verbose',
            action='store_true',
            help='Enable verbose logging (defaults to false)'
        )
        
        parser.add_argument(
            '--debug',
            action='store_true',
            help='Enable debug logging and generate audit files (defaults to false)'
        )
        
        return parser
    
    def run(self) -> int:
        """Main orchestration workflow."""
        try:
            args = self.parser.parse_args()
            self.verbose = args.verbose
            self.debug = args.debug
            
            if self.verbose or self.debug:
                print(f"🔍 {'Debug' if self.debug else 'Verbose'} mode enabled")
                print(f"📁 Directory: {args.directory}")
                print(f"📂 Output Directory: {args.outputDir}")
                print(f"📄 Filename: {args.filename}")
                print(f"🚫 Ignore pattern: {args.ignore_pattern}")
            
            # Validate inputs
            if not os.path.exists(args.directory):
                print(f"❌ Error: Directory '{args.directory}' does not exist")
                return 1
            
            # Create output directory if it doesn't exist
            os.makedirs(args.outputDir, exist_ok=True)
            
            # Construct full output path
            output_path = os.path.join(args.outputDir, f"{args.filename}.xlsx")
            
            # Initialize agents
            ingestor = IngestorAI(args.directory, args.ignore_pattern, self.verbose, self.debug)
            nexus = NexusAI(self.verbose, self.debug)
            viz = VizAI(self.verbose, self.debug)
            
            # Execute workflow
            if self.verbose:
                print("🔄 Loading JSON files...")
            raw_data = ingestor.load_json_files()
            
            if not raw_data:
                print("❌ No valid JSON files found")
                return 1
            
            print(f"✅ Loaded {len(raw_data)} JSON files")
            
            if self.verbose:
                print("🔄 Transforming data...")
            dataframes = nexus.transform_data(raw_data)
            
            if self.verbose:
                print("🔄 Generating Excel report...")
            viz.create_excel_report(dataframes, output_path)
            
            print(f"✅ Report generated successfully: {output_path}")
            
            if self.debug:
                # Generate audit files
                audit_path = os.path.join(args.outputDir, f"{args.filename}_audit.json")
                self._generate_audit_file(raw_data, dataframes, audit_path)
                print(f"🔍 Debug audit file generated: {audit_path}")
            
            return 0
            
        except KeyboardInterrupt:
            print("\n❌ Operation cancelled by user")
            return 1
        except Exception as e:
            print(f"❌ Error: {e}")
            if self.debug:
                import traceback
                traceback.print_exc()
            return 1
    
    def _generate_audit_file(self, raw_data: List[Dict[str, Any]], 
                           dataframes: Dict[str, pd.DataFrame], audit_path: str):
        """Generate audit file for debugging."""
        audit_data = {
            "generated_at": datetime.now().isoformat(),
            "input_files_count": len(raw_data),
            "dataframes_summary": {
                name: {
                    "rows": len(df),
                    "columns": len(df.columns),
                    "columns_list": list(df.columns)
                }
                for name, df in dataframes.items()
            },
            "sample_raw_data": raw_data[0] if raw_data else None
        }
        
        with open(audit_path, 'w', encoding='utf-8') as f:
            json.dump(audit_data, f, indent=2, default=str)


class IngestorAI:
    """Data Acquisition Layer - Loads and validates JSON files."""
    
    def __init__(self, directory: str, ignore_pattern: str, verbose: bool = False, debug: bool = False):
        self.directory = directory
        self.ignore_pattern = ignore_pattern
        self.verbose = verbose
        self.debug = debug
        
    def load_json_files(self) -> List[Dict[str, Any]]:
        """Load and parse all valid JSON files from directory."""
        json_files = glob(os.path.join(self.directory, "*.json"))
        ignore_files = glob(os.path.join(self.directory, self.ignore_pattern))
        
        # Filter out ignored files
        valid_files = [f for f in json_files if f not in ignore_files]
        
        if self.verbose or self.debug:
            print(f"📁 Found {len(json_files)} JSON files")
            print(f"🚫 Ignoring {len(ignore_files)} files matching pattern")
            print(f"✅ Processing {len(valid_files)} files")
        
        raw_data = []
        
        for file_path in valid_files:
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    
                # Validate basic structure
                if self._validate_json_structure(data):
                    data['_source_file'] = os.path.basename(file_path)
                    raw_data.append(data)
                    if self.debug:
                        print(f"✅ Loaded: {os.path.basename(file_path)}")
                else:
                    if self.verbose or self.debug:
                        print(f"⚠️  Invalid structure: {os.path.basename(file_path)}")
                        
            except json.JSONDecodeError as e:
                if self.verbose or self.debug:
                    print(f"❌ JSON error in {os.path.basename(file_path)}: {e}")
            except Exception as e:
                if self.verbose or self.debug:
                    print(f"❌ Error loading {os.path.basename(file_path)}: {e}")
        
        return raw_data
    
    def _validate_json_structure(self, data: Dict[str, Any]) -> bool:
        """Validate that JSON has required structure."""
        required_keys = ['metadata', 'summary', 'analytics']
        return all(key in data for key in required_keys)


class NexusAI:
    """Data Transformation Layer - Processes raw JSON into structured dataframes."""
    
    def __init__(self, verbose: bool = False, debug: bool = False):
        self.verbose = verbose
        self.debug = debug
        
    def transform_data(self, raw_data: List[Dict[str, Any]]) -> Dict[str, pd.DataFrame]:
        """Transform raw JSON data into structured dataframes."""
        dataframes = {}
        
        # Create overview dataframe
        dataframes['overview'] = self._create_overview_df(raw_data)
        
        # Create detail dataframes
        dataframes['pull_requests'] = self._create_pull_requests_df(raw_data)
        dataframes['commits'] = self._create_commits_df(raw_data)
        dataframes['work_patterns'] = self._create_work_patterns_df(raw_data)
        dataframes['files_changed'] = self._create_files_changed_df(raw_data)
        
        if self.debug:
            for name, df in dataframes.items():
                print(f"📊 {name}: {len(df)} rows, {len(df.columns)} columns")
                # Check for NaN/Inf values in debug mode
                numeric_cols = df.select_dtypes(include=['number']).columns
                for col in numeric_cols:
                    nan_count = df[col].isna().sum()
                    inf_count = df[col].apply(lambda x: x == float('inf') if pd.notna(x) else False).sum()
                    if nan_count > 0 or inf_count > 0:
                        print(f"⚠️  {name}.{col}: {nan_count} NaN, {inf_count} Inf values")
        
        return dataframes
    
    def _safe_divide(self, numerator: float, denominator: float, default: float = 0.0) -> float:
        """Safely divide two numbers, avoiding division by zero and returning valid results."""
        if denominator == 0 or pd.isna(denominator) or pd.isna(numerator):
            return default
        result = numerator / denominator
        if result == float('inf') or result == float('-inf'):
            return default
        return result
    
    def _safe_percentage(self, part: float, total: float) -> float:
        """Safely calculate percentage, ensuring valid results."""
        if total == 0 or pd.isna(total) or pd.isna(part):
            return 0.0
        result = (part / total) * 100
        if result == float('inf') or result == float('-inf') or pd.isna(result):
            return 0.0
        return min(max(result, 0.0), 100.0)  # Clamp between 0 and 100
        
    def _create_overview_df(self, raw_data: List[Dict[str, Any]]) -> pd.DataFrame:
        """Create developer overview dataframe."""
        overview_records = []
        
        for data in raw_data:
            metadata = data.get('metadata', {})
            summary = data.get('summary', {})
            analytics = data.get('analytics', {})
            
            # Extract key metrics
            pr_throughput = analytics.get('prThroughput', {})
            code_churn = analytics.get('codeChurn', {})
            work_patterns = analytics.get('workPatterns', {})
            pr_cycle_time = analytics.get('prCycleTime', {})
            
            record = {
                'Developer': metadata.get('searchUser', 'Unknown'),
                'Source_File': data.get('_source_file', 'Unknown'),
                'Date_Range_Start': metadata.get('dateRange', {}).get('start', ''),
                'Date_Range_End': metadata.get('dateRange', {}).get('end', ''),
                'Total_Contributions': summary.get('totalContributions', 0),
                'Total_Commits': summary.get('totalCommits', 0),
                'Total_PRs_Created': summary.get('totalPRsCreated', 0),
                'Total_Reviews_Submitted': summary.get('totalReviewsSubmitted', 0),
                'Lines_Added': summary.get('linesAdded', 0),
                'Lines_Deleted': summary.get('linesDeleted', 0),
                'Net_Change': summary.get('linesAdded', 0) - summary.get('linesDeleted', 0),
                'Merge_Rate_Percent': pr_throughput.get('mergeRate', 0),
                'Avg_Time_To_Merge': pr_throughput.get('avgTimeToMerge', 'N/A'),
                'After_Hours_Percent': work_patterns.get('afterHoursPercentage', 0),
                'Most_Active_Day': work_patterns.get('mostActiveDay', 'Unknown'),
                'Avg_Cycle_Time_Days': pr_cycle_time.get('avgCycleTime', 0),
                'Total_Repositories': len(metadata.get('repositoriesAnalyzed', [])),
                'Generated_At': metadata.get('generatedAt', ''),
                
                # Risk indicators
                'Risk_Low_Merge_Rate': pr_throughput.get('mergeRate', 0) < 80,
                'Risk_No_Reviews': summary.get('totalReviewsSubmitted', 0) == 0,
                'Risk_Slow_Cycle_Time': pr_cycle_time.get('avgCycleTime', 0) > 5,
                'Risk_High_After_Hours': work_patterns.get('afterHoursPercentage', 0) > 25,
                'Risk_Very_High_After_Hours': work_patterns.get('afterHoursPercentage', 0) > 50,
                'Risk_Low_Activity': summary.get('totalContributions', 0) < 10,
            }
            
            overview_records.append(record)
        
        return pd.DataFrame(overview_records)
    
    def _create_pull_requests_df(self, raw_data: List[Dict[str, Any]]) -> pd.DataFrame:
        """Create pull requests detail dataframe."""
        pr_records = []
        
        for data in raw_data:
            developer = data.get('metadata', {}).get('searchUser', 'Unknown')
            source_file = data.get('_source_file', 'Unknown')
            
            # From analytics
            pr_throughput = data.get('analytics', {}).get('prThroughput', {})
            pr_details = pr_throughput.get('details', [])
            
            for pr in pr_details:
                record = {
                    'Developer': developer,
                    'Source_File': source_file,
                    'PR_Number': pr.get('number', 0),
                    'Title': pr.get('title', ''),
                    'Repository': pr.get('repository', ''),
                    'State': pr.get('state', ''),
                    'Created_At': pr.get('created_at', ''),
                    'Merged_At': pr.get('merged_at', ''),
                    'Closed_At': pr.get('closed_at', ''),
                    'Additions': pr.get('additions', 0),
                    'Deletions': pr.get('deletions', 0),
                    'Changed_Files': pr.get('changed_files', 0),
                    'Net_Change': pr.get('additions', 0) - pr.get('deletions', 0),
                    'Size_Category': self._categorize_pr_size(pr.get('additions', 0) + pr.get('deletions', 0)),
                }
                pr_records.append(record)
            
            # From rawData if available and not duplicate
            raw_data_section = data.get('rawData', {})
            raw_prs = raw_data_section.get('pullRequests', [])
            
            for pr in raw_prs:
                # Only add if not already added from analytics
                pr_number = pr.get('number', 0)
                if not any(r['PR_Number'] == pr_number and r['Developer'] == developer for r in pr_records):
                    repository_name = pr.get('repository', {})
                    if isinstance(repository_name, dict):
                        repository_name = repository_name.get('full_name', '')
                    
                    record = {
                        'Developer': developer,
                        'Source_File': source_file,
                        'PR_Number': pr_number,
                        'Title': pr.get('title', ''),
                        'Repository': repository_name,
                        'State': pr.get('state', ''),
                        'Created_At': pr.get('created_at', ''),
                        'Merged_At': pr.get('merged_at', ''),
                        'Closed_At': pr.get('closed_at', ''),
                        'Additions': pr.get('additions', 0),
                        'Deletions': pr.get('deletions', 0),
                        'Changed_Files': pr.get('changed_files', 0),
                        'Net_Change': pr.get('additions', 0) - pr.get('deletions', 0),
                        'Size_Category': self._categorize_pr_size(pr.get('additions', 0) + pr.get('deletions', 0)),
                    }
                    pr_records.append(record)
        
        return pd.DataFrame(pr_records)
    
    def _create_commits_df(self, raw_data: List[Dict[str, Any]]) -> pd.DataFrame:
        """Create commits detail dataframe."""
        commit_records = []
        
        for data in raw_data:
            developer = data.get('metadata', {}).get('searchUser', 'Unknown')
            source_file = data.get('_source_file', 'Unknown')
            
            # From analytics
            code_churn = data.get('analytics', {}).get('codeChurn', {})
            commit_details = code_churn.get('details', [])
            
            for commit in commit_details:
                author = commit.get('author', {})
                stats = commit.get('stats', {})
                
                record = {
                    'Developer': developer,
                    'Source_File': source_file,
                    'SHA': commit.get('sha', ''),
                    'Message': commit.get('message', '')[:100],  # Truncate long messages
                    'Repository': commit.get('repository', ''),
                    'Author_Name': author.get('name', ''),
                    'Author_Email': author.get('email', ''),
                    'Date': author.get('date', ''),
                    'Additions': stats.get('additions', 0),
                    'Deletions': stats.get('deletions', 0),
                    'Total_Changes': stats.get('total', 0),
                    'Net_Change': stats.get('additions', 0) - stats.get('deletions', 0),
                    'Size_Category': self._categorize_commit_size(stats.get('total', 0)),
                }
                commit_records.append(record)
        
        return pd.DataFrame(commit_records)
    
    def _create_work_patterns_df(self, raw_data: List[Dict[str, Any]]) -> pd.DataFrame:
        """Create work patterns dataframe."""
        pattern_records = []
        
        for data in raw_data:
            developer = data.get('metadata', {}).get('searchUser', 'Unknown')
            source_file = data.get('_source_file', 'Unknown')
            work_patterns = data.get('analytics', {}).get('workPatterns', {})
            
            total_activities = work_patterns.get('totalActivities', 0)
            
            # Day distribution
            day_dist = work_patterns.get('dayDistribution', {})
            for day, count in day_dist.items():
                percentage = self._safe_percentage(count, total_activities)
                record = {
                    'Developer': developer,
                    'Source_File': source_file,
                    'Type': 'Day',
                    'Period': day,
                    'Activity_Count': count,
                    'Total_Activities': total_activities,
                    'Percentage': percentage,
                    'Is_After_Hours': False,  # Days are not after hours
                }
                pattern_records.append(record)
            
            # Hour distribution
            hour_dist = work_patterns.get('hourDistribution', {})
            for hour, count in hour_dist.items():
                try:
                    hour_int = int(hour)
                    is_after_hours = hour_int < 9 or hour_int > 17
                except (ValueError, TypeError):
                    is_after_hours = False
                    
                percentage = self._safe_percentage(count, total_activities)
                record = {
                    'Developer': developer,
                    'Source_File': source_file,
                    'Type': 'Hour',
                    'Period': f"{hour}:00",
                    'Activity_Count': count,
                    'Total_Activities': total_activities,
                    'Percentage': percentage,
                    'Is_After_Hours': is_after_hours,
                }
                pattern_records.append(record)
        
        df = pd.DataFrame(pattern_records)
        
        # Clean up any remaining NaN or inf values
        numeric_columns = df.select_dtypes(include=['number']).columns
        for col in numeric_columns:
            df[col] = df[col].replace([float('inf'), float('-inf')], 0)
            df[col] = df[col].fillna(0)
        
        return df
    
    def _create_files_changed_df(self, raw_data: List[Dict[str, Any]]) -> pd.DataFrame:
        """Create files changed dataframe from pull request data."""
        file_records = []
        
        for data in raw_data:
            developer = data.get('metadata', {}).get('searchUser', 'Unknown')
            source_file = data.get('_source_file', 'Unknown')
            
            # Get PRs from analytics
            pr_throughput = data.get('analytics', {}).get('prThroughput', {})
            pr_details = pr_throughput.get('details', [])
            
            for pr in pr_details:
                record = {
                    'Developer': developer,
                    'Source_File': source_file,
                    'PR_Number': pr.get('number', 0),
                    'Repository': pr.get('repository', ''),
                    'Files_Changed_Count': pr.get('changed_files', 0),
                    'Total_Additions': pr.get('additions', 0),
                    'Total_Deletions': pr.get('deletions', 0),
                    'Date_Created': pr.get('created_at', ''),
                    'State': pr.get('state', ''),
                }
                file_records.append(record)
        
        return pd.DataFrame(file_records)
    
    def _categorize_pr_size(self, total_changes: int) -> str:
        """Categorize PR size based on total changes."""
        if total_changes <= 50:
            return 'Small'
        elif total_changes <= 500:
            return 'Medium'
        else:
            return 'Large'
    
    def _categorize_commit_size(self, total_changes: int) -> str:
        """Categorize commit size based on total changes."""
        if total_changes <= 50:
            return 'Small'
        elif total_changes <= 500:
            return 'Medium'
        else:
            return 'Large'


class VizAI:
    """Visualization & Output Layer - Creates Excel reports with formatting."""
    
    def __init__(self, verbose: bool = False, debug: bool = False):
        self.verbose = verbose
        self.debug = debug
        
    def _sanitize_numeric_value(self, value):
        """Convert NaN/Inf to readable alternatives."""
        if pd.isna(value):
            return 0
        elif value == float('inf'):
            return 999999
        elif value == float('-inf'):
            return -999999
        elif isinstance(value, (int, float)) and not pd.isna(value):
            return value
        else:
            return value
        
    def create_excel_report(self, dataframes: Dict[str, pd.DataFrame], output_path: str):
        """Create Excel workbook with multiple sheets and formatting."""
        # Configure workbook to handle NaN/Inf values gracefully
        workbook = xlsxwriter.Workbook(output_path, {
            'nan_inf_to_errors': True,  # Convert NaN/Inf to #NUM! error
            'default_date_format': 'yyyy-mm-dd'
        })
        
        # Define formats
        formats = self._create_formats(workbook)
        
        # Create sheets
        self._create_dashboard_sheet(workbook, dataframes, formats)
        self._create_overview_sheet(workbook, dataframes, formats)
        self._create_pull_requests_sheet(workbook, dataframes, formats)
        self._create_commits_sheet(workbook, dataframes, formats)
        self._create_work_patterns_sheet(workbook, dataframes, formats)
        self._create_files_changed_sheet(workbook, dataframes, formats)
        self._create_data_dictionary_sheet(workbook, dataframes, formats)
        
        workbook.close()
        
        if self.debug:
            print(f"📊 Excel report created with 7 sheets")
    
    def _create_formats(self, workbook) -> Dict[str, Format]:
        """Create formatting styles for the workbook."""
        formats = {}
        
        # Header format
        formats['header'] = workbook.add_format({
            'bold': True,
            'font_size': 12,
            'bg_color': '#4472C4',
            'font_color': 'white',
            'border': 1,
            'align': 'center',
            'valign': 'vcenter'
        })
        
        # Dictionary header format
        formats['dict_header'] = workbook.add_format({
            'bold': True,
            'font_size': 11,
            'bg_color': '#70AD47',
            'font_color': 'white',
            'border': 1,
            'align': 'center',
            'valign': 'vcenter'
        })
        
        # Risk highlighting
        formats['risk_high'] = workbook.add_format({
            'bg_color': '#FF4444',
            'font_color': 'white',
            'bold': True
        })
        
        formats['risk_medium'] = workbook.add_format({
            'bg_color': '#FFD700',
            'font_color': 'black'
        })
        
        formats['risk_low'] = workbook.add_format({
            'bg_color': '#90EE90',
            'font_color': 'black'
        })
        
        # Number formats
        formats['percent'] = workbook.add_format({'num_format': '0.00%'})
        formats['number'] = workbook.add_format({'num_format': '#,##0'})
        formats['decimal'] = workbook.add_format({'num_format': '#,##0.00'})
        
        # General cell format
        formats['cell'] = workbook.add_format({
            'border': 1,
            'valign': 'vcenter'
        })
        
        return formats
    
    def _write_value_safely(self, worksheet, row, col, value, cell_format=None):
        """Safely write a value to worksheet, handling NaN/Inf cases."""
        if isinstance(value, (int, float)):
            value = self._sanitize_numeric_value(value)
        
        try:
            if cell_format:
                worksheet.write(row, col, value, cell_format)
            else:
                worksheet.write(row, col, value)
        except Exception as e:
            # Fallback: write as string if numeric write fails
            if self.debug:
                print(f"⚠️  Write error at ({row}, {col}): {e}, writing as string")
            worksheet.write(row, col, str(value), cell_format)
    
    def _create_dashboard_sheet(self, workbook, dataframes: Dict[str, pd.DataFrame], formats: Dict[str, Format]):
        """Create executive dashboard sheet."""
        worksheet = workbook.add_worksheet('Dashboard')
        
        # Title
        worksheet.merge_range('A1:H1', 'Developer Insights Dashboard', formats['header'])
        worksheet.set_row(0, 25)
        
        # Summary statistics
        overview_df = dataframes['overview']
        
        if not overview_df.empty:
            # Key metrics
            row = 3
            self._write_value_safely(worksheet, row, 0, 'Key Metrics Summary', formats['header'])
            
            metrics = [
                ('Total Developers', len(overview_df)),
                ('Total Contributions', overview_df['Total_Contributions'].sum()),
                ('Total Commits', overview_df['Total_Commits'].sum()),
                ('Total PRs Created', overview_df['Total_PRs_Created'].sum()),
                ('Average Merge Rate', f"{overview_df['Merge_Rate_Percent'].mean():.1f}%"),
                ('Average After Hours %', f"{overview_df['After_Hours_Percent'].mean():.1f}%"),
            ]
            
            for i, (metric, value) in enumerate(metrics, 1):
                self._write_value_safely(worksheet, row + i, 0, metric, formats['cell'])
                self._write_value_safely(worksheet, row + i, 1, value, formats['cell'])
            
            # Risk indicators
            row += len(metrics) + 3
            self._write_value_safely(worksheet, row, 0, 'Risk Indicators', formats['header'])
            
            risk_counts = [
                ('Low Merge Rate (<80%)', overview_df['Risk_Low_Merge_Rate'].sum()),
                ('No Code Reviews', overview_df['Risk_No_Reviews'].sum()),
                ('Slow Cycle Time (>5 days)', overview_df['Risk_Slow_Cycle_Time'].sum()),
                ('High After Hours (>25%)', overview_df['Risk_High_After_Hours'].sum()),
                ('Very High After Hours (>50%)', overview_df['Risk_Very_High_After_Hours'].sum()),
                ('Low Activity (<10 contributions)', overview_df['Risk_Low_Activity'].sum()),
            ]
            
            for i, (risk, count) in enumerate(risk_counts, 1):
                self._write_value_safely(worksheet, row + i, 0, risk, formats['cell'])
                cell_format = formats['risk_high'] if count > 0 else formats['risk_low']
                self._write_value_safely(worksheet, row + i, 1, count, cell_format)
        
        # Column widths
        worksheet.set_column('A:A', 25)
        worksheet.set_column('B:B', 15)
    
    def _create_overview_sheet(self, workbook, dataframes: Dict[str, pd.DataFrame], formats: Dict[str, Format]):
        """Create developers overview sheet with conditional formatting."""
        worksheet = workbook.add_worksheet('Developers Overview')
        
        df = dataframes['overview']
        if df.empty:
            self._write_value_safely(worksheet, 0, 0, 'No data available')
            return
        
        # Write headers
        headers = list(df.columns)
        for col, header in enumerate(headers):
            self._write_value_safely(worksheet, 0, col, header, formats['header'])
        
        # Write data with conditional formatting
        for row_idx, (_, row) in enumerate(df.iterrows(), 1):
            for col_idx, (col_name, value) in enumerate(row.items()):
                cell_format = formats['cell']
                
                # Apply risk-based formatting
                if col_name == 'Merge_Rate_Percent' and pd.notna(value):
                    if value < 80:
                        cell_format = formats['risk_medium']
                elif col_name == 'Total_Reviews_Submitted' and pd.notna(value):
                    if value == 0:
                        cell_format = formats['risk_high']
                elif col_name == 'Avg_Cycle_Time_Days' and pd.notna(value):
                    if value > 5:
                        cell_format = formats['risk_medium']
                elif col_name == 'After_Hours_Percent' and pd.notna(value):
                    if value > 50:
                        cell_format = formats['risk_high']
                    elif value > 25:
                        cell_format = formats['risk_medium']
                elif col_name == 'Total_Contributions' and pd.notna(value):
                    if value < 10:
                        cell_format = formats['risk_medium']
                
                self._write_value_safely(worksheet, row_idx, col_idx, value, cell_format)
        
        # Auto-fit columns
        for col in range(len(headers)):
            worksheet.set_column(col, col, 15)
        
        # Freeze panes
        worksheet.freeze_panes(1, 0)
    
    def _create_pull_requests_sheet(self, workbook, dataframes: Dict[str, pd.DataFrame], formats: Dict[str, Format]):
        """Create pull requests detail sheet."""
        worksheet = workbook.add_worksheet('All Pull Requests')
        
        df = dataframes['pull_requests']
        if df.empty:
            self._write_value_safely(worksheet, 0, 0, 'No pull request data available')
            return
        
        # Write headers
        headers = list(df.columns)
        for col, header in enumerate(headers):
            self._write_value_safely(worksheet, 0, col, header, formats['header'])
        
        # Write data
        for row_idx, (_, row) in enumerate(df.iterrows(), 1):
            for col_idx, (col_name, value) in enumerate(row.items()):
                cell_format = formats['cell']
                
                # Highlight large PRs
                if col_name == 'Size_Category' and value == 'Large':
                    cell_format = formats['risk_medium']
                
                self._write_value_safely(worksheet, row_idx, col_idx, value, cell_format)
        
        # Auto-fit columns
        for col in range(len(headers)):
            worksheet.set_column(col, col, 15)
        
        # Freeze panes
        worksheet.freeze_panes(1, 0)
    
    def _create_commits_sheet(self, workbook, dataframes: Dict[str, pd.DataFrame], formats: Dict[str, Format]):
        """Create commits detail sheet."""
        worksheet = workbook.add_worksheet('All Commits')
        
        df = dataframes['commits']
        if df.empty:
            self._write_value_safely(worksheet, 0, 0, 'No commit data available')
            return
        
        # Write headers
        headers = list(df.columns)
        for col, header in enumerate(headers):
            self._write_value_safely(worksheet, 0, col, header, formats['header'])
        
        # Write data with size-based formatting
        for row_idx, (_, row) in enumerate(df.iterrows(), 1):
            for col_idx, (col_name, value) in enumerate(row.items()):
                cell_format = formats['cell']
                
                # Highlight large commits
                if col_name == 'Size_Category' and value == 'Large':
                    cell_format = formats['risk_medium']
                
                self._write_value_safely(worksheet, row_idx, col_idx, value, cell_format)
        
        # Auto-fit columns
        for col in range(len(headers)):
            worksheet.set_column(col, col, 15)
        
        # Freeze panes
        worksheet.freeze_panes(1, 0)
    
    def _create_work_patterns_sheet(self, workbook, dataframes: Dict[str, pd.DataFrame], formats: Dict[str, Format]):
        """Create work patterns detail sheet."""
        worksheet = workbook.add_worksheet('Work Patterns')
        
        df = dataframes['work_patterns']
        if df.empty:
            self._write_value_safely(worksheet, 0, 0, 'No work pattern data available')
            return
        
        # Write headers
        headers = list(df.columns)
        for col, header in enumerate(headers):
            self._write_value_safely(worksheet, 0, col, header, formats['header'])
        
        # Write data with after-hours highlighting
        for row_idx, (_, row) in enumerate(df.iterrows(), 1):
            for col_idx, (col_name, value) in enumerate(row.items()):
                cell_format = formats['cell']
                
                # Highlight after-hours activities
                if col_name == 'Is_After_Hours' and value == True:
                    cell_format = formats['risk_medium']
                
                self._write_value_safely(worksheet, row_idx, col_idx, value, cell_format)
        
        # Auto-fit columns
        for col in range(len(headers)):
            worksheet.set_column(col, col, 15)
        
        # Freeze panes
        worksheet.freeze_panes(1, 0)
    
    def _create_files_changed_sheet(self, workbook, dataframes: Dict[str, pd.DataFrame], formats: Dict[str, Format]):
        """Create files changed detail sheet."""
        worksheet = workbook.add_worksheet('Files Changed')
        
        df = dataframes['files_changed']
        if df.empty:
            self._write_value_safely(worksheet, 0, 0, 'No files changed data available')
            return
        
        # Write headers
        headers = list(df.columns)
        for col, header in enumerate(headers):
            self._write_value_safely(worksheet, 0, col, header, formats['header'])
        
        # Write data with highlighting for large file changes
        for row_idx, (_, row) in enumerate(df.iterrows(), 1):
            for col_idx, (col_name, value) in enumerate(row.items()):
                cell_format = formats['cell']
                
                # Highlight large file changes
                if col_name == 'Files_Changed_Count' and pd.notna(value) and value > 20:
                    cell_format = formats['risk_medium']
                
                self._write_value_safely(worksheet, row_idx, col_idx, value, cell_format)
        
        # Auto-fit columns
        for col in range(len(headers)):
            worksheet.set_column(col, col, 15)
        
        # Freeze panes
        worksheet.freeze_panes(1, 0)
    
    def _create_data_dictionary_sheet(self, workbook, dataframes: Dict[str, pd.DataFrame], formats: Dict[str, Format]):
        """Create data dictionary sheet documenting all columns."""
        worksheet = workbook.add_worksheet('Data_Dictionary')
        
        # Headers for data dictionary
        dict_headers = ['Worksheet Name', 'Column Name', 'Value Description', 'Source / Criteria', 'Formula (if any)']
        for col, header in enumerate(dict_headers):
            self._write_value_safely(worksheet, 0, col, header, formats['dict_header'])
        
        # Define all column documentation
        column_docs = self._get_column_documentation()
        
        row = 1
        for sheet_name, columns in column_docs.items():
            for column_info in columns:
                for col_idx, value in enumerate([
                    sheet_name,
                    column_info['name'],
                    column_info['description'],
                    column_info['source'],
                    column_info['formula']
                ]):
                    self._write_value_safely(worksheet, row, col_idx, value, formats['cell'])
                row += 1
        
        # Auto-fit columns
        worksheet.set_column('A:A', 20)  # Worksheet Name
        worksheet.set_column('B:B', 25)  # Column Name
        worksheet.set_column('C:C', 50)  # Value Description
        worksheet.set_column('D:D', 40)  # Source / Criteria
        worksheet.set_column('E:E', 30)  # Formula
        
        # Freeze panes
        worksheet.freeze_panes(1, 0)
    
    def _get_column_documentation(self) -> Dict[str, List[Dict[str, str]]]:
        """Get comprehensive documentation for all columns across all sheets."""
        return {
            "Dashboard": [
                {"name": "Key Metrics Summary", "description": "Section header for overall team metrics", 
                 "source": "Calculated from overview data", "formula": "N/A"},
                {"name": "Total Developers", "description": "Number of unique developers analyzed", 
                 "source": "Count of records in overview dataframe", "formula": "COUNT(overview records)"},
                {"name": "Total Contributions", "description": "Sum of all contributions across developers", 
                 "source": "summary.totalContributions", "formula": "SUM(Total_Contributions)"},
                {"name": "Total Commits", "description": "Sum of all commits across developers", 
                 "source": "summary.totalCommits", "formula": "SUM(Total_Commits)"},
                {"name": "Total PRs Created", "description": "Sum of all pull requests created", 
                 "source": "summary.totalPRsCreated", "formula": "SUM(Total_PRs_Created)"},
                {"name": "Average Merge Rate", "description": "Team average of individual merge rates", 
                 "source": "analytics.prThroughput.mergeRate", "formula": "AVERAGE(Merge_Rate_Percent)"},
                {"name": "Average After Hours %", "description": "Team average of after-hours work percentage", 
                 "source": "analytics.workPatterns.afterHoursPercentage", "formula": "AVERAGE(After_Hours_Percent)"},
                {"name": "Risk Indicators", "description": "Section showing count of developers with various risk factors", 
                 "source": "Calculated risk flags", "formula": "N/A"},
            ],
            "Developers Overview": [
                {"name": "Developer", "description": "Developer username or identifier", 
                 "source": "metadata.searchUser", "formula": "N/A"},
                {"name": "Source_File", "description": "JSON filename that contained this developer's data", 
                 "source": "Added during file processing", "formula": "N/A"},
                {"name": "Date_Range_Start", "description": "Start date of analysis period", 
                 "source": "metadata.dateRange.start", "formula": "N/A"},
                {"name": "Date_Range_End", "description": "End date of analysis period", 
                 "source": "metadata.dateRange.end", "formula": "N/A"},
                {"name": "Total_Contributions", "description": "Total number of contributions (commits + PRs)", 
                 "source": "summary.totalContributions", "formula": "N/A"},
                {"name": "Total_Commits", "description": "Total number of commits made", 
                 "source": "summary.totalCommits", "formula": "N/A"},
                {"name": "Total_PRs_Created", "description": "Total number of pull requests created", 
                 "source": "summary.totalPRsCreated", "formula": "N/A"},
                {"name": "Total_Reviews_Submitted", "description": "Total number of code reviews submitted", 
                 "source": "summary.totalReviewsSubmitted", "formula": "N/A"},
                {"name": "Lines_Added", "description": "Total lines of code added across all commits", 
                 "source": "summary.linesAdded", "formula": "N/A"},
                {"name": "Lines_Deleted", "description": "Total lines of code deleted across all commits", 
                 "source": "summary.linesDeleted", "formula": "N/A"},
                {"name": "Net_Change", "description": "Net change in lines of code", 
                 "source": "Calculated", "formula": "Lines_Added - Lines_Deleted"},
                {"name": "Merge_Rate_Percent", "description": "Percentage of PRs that were successfully merged", 
                 "source": "analytics.prThroughput.mergeRate", "formula": "N/A"},
                {"name": "Avg_Time_To_Merge", "description": "Average time from PR creation to merge", 
                 "source": "analytics.prThroughput.avgTimeToMerge", "formula": "N/A"},
                {"name": "After_Hours_Percent", "description": "Percentage of work done outside business hours (9 AM - 5 PM)", 
                 "source": "analytics.workPatterns.afterHoursPercentage", "formula": "N/A"},
                {"name": "Most_Active_Day", "description": "Day of the week with highest activity", 
                 "source": "analytics.workPatterns.mostActiveDay", "formula": "N/A"},
                {"name": "Avg_Cycle_Time_Days", "description": "Average PR cycle time in days", 
                 "source": "analytics.prCycleTime.avgCycleTime", "formula": "N/A"},
                {"name": "Total_Repositories", "description": "Number of repositories analyzed for this developer", 
                 "source": "metadata.repositoriesAnalyzed", "formula": "COUNT(repositoriesAnalyzed)"},
                {"name": "Generated_At", "description": "Timestamp when the report was generated", 
                 "source": "metadata.generatedAt", "formula": "N/A"},
                {"name": "Risk_Low_Merge_Rate", "description": "Flag indicating merge rate below 80%", 
                 "source": "Calculated", "formula": "IF(Merge_Rate_Percent < 80, TRUE, FALSE)"},
                {"name": "Risk_No_Reviews", "description": "Flag indicating zero code reviews submitted", 
                 "source": "Calculated", "formula": "IF(Total_Reviews_Submitted = 0, TRUE, FALSE)"},
                {"name": "Risk_Slow_Cycle_Time", "description": "Flag indicating cycle time above 5 days", 
                 "source": "Calculated", "formula": "IF(Avg_Cycle_Time_Days > 5, TRUE, FALSE)"},
                {"name": "Risk_High_After_Hours", "description": "Flag indicating after-hours work above 25%", 
                 "source": "Calculated", "formula": "IF(After_Hours_Percent > 25, TRUE, FALSE)"},
                {"name": "Risk_Very_High_After_Hours", "description": "Flag indicating after-hours work above 50%", 
                 "source": "Calculated", "formula": "IF(After_Hours_Percent > 50, TRUE, FALSE)"},
                {"name": "Risk_Low_Activity", "description": "Flag indicating low contribution activity (less than 10 contributions)", 
                 "source": "Calculated", "formula": "IF(Total_Contributions < 10, TRUE, FALSE)"},
            ],
            "All Pull Requests": [
                {"name": "Developer", "description": "Developer who created the pull request", 
                 "source": "metadata.searchUser", "formula": "N/A"},
                {"name": "Source_File", "description": "JSON filename containing this PR data", 
                 "source": "Added during processing", "formula": "N/A"},
                {"name": "PR_Number", "description": "Pull request number", 
                 "source": "analytics.prThroughput.details[].number or rawData.pullRequests[].number", "formula": "N/A"},
                {"name": "Title", "description": "Pull request title", 
                 "source": "analytics.prThroughput.details[].title or rawData.pullRequests[].title", "formula": "N/A"},
                {"name": "Repository", "description": "Repository name where PR was created", 
                 "source": "analytics.prThroughput.details[].repository or rawData.pullRequests[].repository.full_name", "formula": "N/A"},
                {"name": "State", "description": "Current state of the pull request (open, closed, merged)", 
                 "source": "analytics.prThroughput.details[].state or rawData.pullRequests[].state", "formula": "N/A"},
                {"name": "Created_At", "description": "Timestamp when PR was created", 
                 "source": "analytics.prThroughput.details[].created_at or rawData.pullRequests[].created_at", "formula": "N/A"},
                {"name": "Merged_At", "description": "Timestamp when PR was merged (if applicable)", 
                 "source": "analytics.prThroughput.details[].merged_at or rawData.pullRequests[].merged_at", "formula": "N/A"},
                {"name": "Closed_At", "description": "Timestamp when PR was closed", 
                 "source": "analytics.prThroughput.details[].closed_at or rawData.pullRequests[].closed_at", "formula": "N/A"},
                {"name": "Additions", "description": "Number of lines added in this PR", 
                 "source": "analytics.prThroughput.details[].additions or rawData.pullRequests[].additions", "formula": "N/A"},
                {"name": "Deletions", "description": "Number of lines deleted in this PR", 
                 "source": "analytics.prThroughput.details[].deletions or rawData.pullRequests[].deletions", "formula": "N/A"},
                {"name": "Changed_Files", "description": "Number of files modified in this PR", 
                 "source": "analytics.prThroughput.details[].changed_files or rawData.pullRequests[].changed_files", "formula": "N/A"},
                {"name": "Net_Change", "description": "Net lines changed (additions minus deletions)", 
                 "source": "Calculated", "formula": "Additions - Deletions"},
                {"name": "Size_Category", "description": "Categorization of PR size (Small ≤50, Medium ≤500, Large >500)", 
                 "source": "Calculated based on total changes", "formula": "IF(Additions+Deletions≤50,'Small',IF(≤500,'Medium','Large'))"},
            ],
            "All Commits": [
                {"name": "Developer", "description": "Developer associated with this commit", 
                 "source": "metadata.searchUser", "formula": "N/A"},
                {"name": "Source_File", "description": "JSON filename containing this commit data", 
                 "source": "Added during processing", "formula": "N/A"},
                {"name": "SHA", "description": "Git commit SHA hash", 
                 "source": "analytics.codeChurn.details[].sha", "formula": "N/A"},
                {"name": "Message", "description": "Commit message (truncated to 100 characters)", 
                 "source": "analytics.codeChurn.details[].message", "formula": "SUBSTRING(message, 1, 100)"},
                {"name": "Repository", "description": "Repository name where commit was made", 
                 "source": "analytics.codeChurn.details[].repository", "formula": "N/A"},
                {"name": "Author_Name", "description": "Name of the commit author", 
                 "source": "analytics.codeChurn.details[].author.name", "formula": "N/A"},
                {"name": "Author_Email", "description": "Email of the commit author", 
                 "source": "analytics.codeChurn.details[].author.email", "formula": "N/A"},
                {"name": "Date", "description": "Timestamp when commit was made", 
                 "source": "analytics.codeChurn.details[].author.date", "formula": "N/A"},
                {"name": "Additions", "description": "Lines of code added in this commit", 
                 "source": "analytics.codeChurn.details[].stats.additions", "formula": "N/A"},
                {"name": "Deletions", "description": "Lines of code deleted in this commit", 
                 "source": "analytics.codeChurn.details[].stats.deletions", "formula": "N/A"},
                {"name": "Total_Changes", "description": "Total lines changed (additions + deletions)", 
                 "source": "analytics.codeChurn.details[].stats.total", "formula": "N/A"},
                {"name": "Net_Change", "description": "Net change in lines (additions - deletions)", 
                 "source": "Calculated", "formula": "Additions - Deletions"},
                {"name": "Size_Category", "description": "Commit size category (Small ≤50, Medium ≤500, Large >500)", 
                 "source": "Calculated based on total changes", "formula": "IF(Total_Changes≤50,'Small',IF(≤500,'Medium','Large'))"},
            ],
            "Work Patterns": [
                {"name": "Developer", "description": "Developer whose work pattern this represents", 
                 "source": "metadata.searchUser", "formula": "N/A"},
                {"name": "Source_File", "description": "JSON filename containing this work pattern data", 
                 "source": "Added during processing", "formula": "N/A"},
                {"name": "Type", "description": "Type of time period (Day or Hour)", 
                 "source": "Derived from dayDistribution or hourDistribution", "formula": "N/A"},
                {"name": "Period", "description": "Specific day name or hour (e.g., 'Monday', '14:00')", 
                 "source": "analytics.workPatterns.dayDistribution keys or hourDistribution keys", "formula": "N/A"},
                {"name": "Activity_Count", "description": "Number of activities in this time period", 
                 "source": "analytics.workPatterns.dayDistribution[period] or hourDistribution[period]", "formula": "N/A"},
                {"name": "Total_Activities", "description": "Total activities across all periods for this developer", 
                 "source": "analytics.workPatterns.totalActivities", "formula": "N/A"},
                {"name": "Percentage", "description": "Percentage of total activities in this period", 
                 "source": "Calculated", "formula": "(Activity_Count / Total_Activities) * 100"},
                {"name": "Is_After_Hours", "description": "Boolean indicating if this time period is outside business hours", 
                 "source": "Calculated for hours < 9 or > 17", "formula": "IF(hour < 9 OR hour > 17, TRUE, FALSE)"},
            ],
            "Files Changed": [
                {"name": "Developer", "description": "Developer who made the file changes", 
                 "source": "metadata.searchUser", "formula": "N/A"},
                {"name": "Source_File", "description": "JSON filename containing this data", 
                 "source": "Added during processing", "formula": "N/A"},
                {"name": "PR_Number", "description": "Pull request number containing file changes", 
                 "source": "analytics.prThroughput.details[].number", "formula": "N/A"},
                {"name": "Repository", "description": "Repository where files were changed", 
                 "source": "analytics.prThroughput.details[].repository", "formula": "N/A"},
                {"name": "Files_Changed_Count", "description": "Number of files modified in the pull request", 
                 "source": "analytics.prThroughput.details[].changed_files", "formula": "N/A"},
                {"name": "Total_Additions", "description": "Total lines added across all files in the PR", 
                 "source": "analytics.prThroughput.details[].additions", "formula": "N/A"},
                {"name": "Total_Deletions", "description": "Total lines deleted across all files in the PR", 
                 "source": "analytics.prThroughput.details[].deletions", "formula": "N/A"},
                {"name": "Date_Created", "description": "Date when the pull request was created", 
                 "source": "analytics.prThroughput.details[].created_at", "formula": "N/A"},
                {"name": "State", "description": "Current state of the pull request", 
                 "source": "analytics.prThroughput.details[].state", "formula": "N/A"},
            ]
        }


def main():
    """Main entry point."""
    orchestrator = OrchestratorCLI()
    sys.exit(orchestrator.run())


if __name__ == '__main__':
    main()

# # Generate report from default directory
# python main.py --directory ./output --outputDir ./reports --filename team_insights

# # With verbose output
# python main.py --directory ./input --outputDir ./output --filename weekly_report --verbose

# # With debug mode (generates audit files)
# python main.py --directory ./output --outputDir ./reports --filename debug_report --debug

# # Custom ignore pattern
# python main.py --directory ./output --outputDir ./reports --filename report --ignore-pattern "*backup*.json"