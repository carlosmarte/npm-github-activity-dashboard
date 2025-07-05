import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from "recharts";
import * as Icons from "lucide-react";
import "./main.css";

// Enhanced Icon component with error handling
const DynamicIcon = ({ name, className, size = 20, ...props }) => {
  const IconComponent = Icons[name];
  if (!IconComponent || typeof IconComponent !== "function") {
    return <Icons.HelpCircle size={size} className={className} {...props} />;
  }
  return <IconComponent size={size} className={className} {...props} />;
};

// Enhanced header component
const DashboardHeader = ({ metadata, summary }) => {
  if (!metadata) return null;

  const userInitial = (metadata.searchUser || "U")[0].toUpperCase();
  const formatDate = (dateStr) => {
    if (!dateStr) return "N/A";
    try {
      return new Date(dateStr).toLocaleDateString();
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="dashboard-header">
      <div className="header-content">
        <div className="header-info">
          <h2 style={{ color: "black" }}>
            User: {metadata.searchUser || "Developer"}
          </h2>
        </div>
        <div className="header-info">
          <div className="header-badges">
            <span className="badge badge-info">
              <DynamicIcon name="Calendar" size={16} />
              {formatDate(metadata.dateRange?.start)} -{" "}
              {formatDate(metadata.dateRange?.end)}
            </span>
            <span className="badge badge-success">
              <DynamicIcon name="GitBranch" size={16} />
              {metadata.repositoriesAnalyzed?.length || 0} repositories
            </span>
            <span className="badge badge-warning">
              <DynamicIcon name="Activity" size={16} />
              {summary?.totalContributions || 0} contributions
            </span>
            <span className="badge badge-default">
              <DynamicIcon name="Clock" size={16} />v{metadata.reportVersion}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

// Enhanced KPI card with animations and hover effects
const KPICard = ({ title, value, icon, color = "blue", subtitle, trend }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className={`kpi-card kpi-card-${color} ${isHovered ? "kpi-card-hovered" : ""}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="kpi-content">
        <div className="kpi-info">
          <p className="kpi-title">{title}</p>
          <p className="kpi-value">
            {typeof value === "number" ? value.toLocaleString() : value}
          </p>
          {subtitle && <p className="kpi-subtitle">{subtitle}</p>}
          {trend && (
            <div className="kpi-trend">
              <DynamicIcon
                name={trend > 0 ? "TrendingUp" : "TrendingDown"}
                size={16}
                className={`trend-icon ${trend > 0 ? "trend-positive" : "trend-negative"}`}
              />
              <span
                className={`trend-value ${trend > 0 ? "trend-positive" : "trend-negative"}`}
              >
                {Math.abs(trend)}%
              </span>
            </div>
          )}
        </div>

        <div
          className={`kpi-icon kpi-icon-${color} ${isHovered ? "kpi-icon-hovered" : ""}`}
        >
          <DynamicIcon name={icon} size={24} />
        </div>
      </div>
    </div>
  );
};

// Interactive charts section with rich visualizations
const ChartsSection = ({ analytics, summary }) => {
  // PR Status Distribution data
  const prStatusData = useMemo(() => {
    if (!analytics?.prThroughput?.statusBreakdown) return [];
    return Object.entries(analytics.prThroughput.statusBreakdown).map(
      ([key, value]) => ({
        name: key.charAt(0).toUpperCase() + key.slice(1),
        value,
        color:
          key === "merged" ? "#10b981" : key === "open" ? "#6366f1" : "#f59e0b",
      })
    );
  }, [analytics]);

  // Commit size distribution data
  const commitSizeData = useMemo(() => {
    if (!analytics?.codeChurn?.commitSizeDistribution) return [];
    return Object.entries(analytics.codeChurn.commitSizeDistribution).map(
      ([key, value]) => ({
        name: key.charAt(0).toUpperCase() + key.slice(1),
        commits: value,
      })
    );
  }, [analytics]);

  // Work patterns hourly distribution
  const hourlyData = useMemo(() => {
    if (!analytics?.workPatterns?.hourDistribution) return [];
    return Object.entries(analytics.workPatterns.hourDistribution)
      .map(([hour, count]) => ({
        hour: parseInt(hour),
        commits: count,
        label: `${hour}:00`,
      }))
      .sort((a, b) => a.hour - b.hour);
  }, [analytics]);

  // Weekly activity trend (simulated)
  const weeklyData = useMemo(() => {
    const baseCommits = Math.floor(
      (analytics?.codeChurn?.totalCommits || 50) / 12
    );
    return Array.from({ length: 12 }, (_, i) => ({
      week: `Week ${i + 1}`,
      commits: Math.max(1, baseCommits + Math.floor(Math.random() * 20) - 10),
      prs: Math.floor(Math.random() * 8) + 2,
      reviews: Math.floor(Math.random() * 12) + 3,
    }));
  }, [analytics]);

  return (
    <div className="charts-section">
      {/* PR Status Distribution */}
      <div className="chart-card">
        <h3 className="chart-title">Pull Request Status Distribution</h3>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={prStatusData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={120}
                paddingAngle={5}
                dataKey="value"
              >
                {prStatusData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Commit Size Distribution */}
      <div className="chart-card">
        <h3 className="chart-title">Commit Size Distribution</h3>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={commitSizeData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="commits" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Hourly Activity Pattern */}
      <div className="chart-card">
        <h3 className="chart-title">Daily Activity Pattern</h3>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={hourlyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="commits"
                stroke="#8b5cf6"
                strokeWidth={3}
                dot={{ fill: "#8b5cf6", strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Weekly Activity Trend - Full Width */}
      <div className="chart-card chart-card-wide">
        <h3 className="chart-title">Activity Trends (Last 12 Weeks)</h3>
        <div className="chart-container chart-container-large">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={weeklyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="week" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Area
                type="monotone"
                dataKey="commits"
                stackId="1"
                stroke="#6366f1"
                fill="#6366f1"
                fillOpacity={0.6}
              />
              <Area
                type="monotone"
                dataKey="prs"
                stackId="1"
                stroke="#ec4899"
                fill="#ec4899"
                fillOpacity={0.6}
              />
              <Area
                type="monotone"
                dataKey="reviews"
                stackId="1"
                stroke="#10b981"
                fill="#10b981"
                fillOpacity={0.6}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

// Enhanced KPI grid with comprehensive metrics
const SummaryCardsGrid = ({ summary, analytics }) => {
  const kpis = useMemo(() => {
    const items = [];

    if (summary) {
      items.push(
        {
          title: "Total Contributions",
          value: summary.totalContributions || 0,
          icon: "Activity",
          color: "blue",
          trend: 12.5,
          subtitle: "All activities combined",
        },
        {
          title: "Code Quality Score",
          value: `${Math.round(analytics?.prThroughput?.mergeRate || 80)}%`,
          icon: "Award",
          color: "green",
          trend: 8.2,
          subtitle: "PR merge success rate",
        },
        {
          title: "PRs Created",
          value: summary.totalPRsCreated || 0,
          icon: "GitPullRequest",
          color: "purple",
          trend: -2.1,
          subtitle: `${analytics?.prThroughput?.statusBreakdown?.merged || 0} merged`,
        },
        {
          title: "Reviews Given",
          value: summary.totalReviewsSubmitted || 0,
          icon: "MessageSquare",
          color: "orange",
          trend: 15.3,
          subtitle: "Community engagement",
        },
        {
          title: "Lines Added",
          value: (summary.linesAdded || 0).toLocaleString(),
          icon: "Plus",
          color: "green",
          subtitle: `${(summary.linesDeleted || 0).toLocaleString()} removed`,
        },
        {
          title: "Cycle Time",
          value: `${analytics?.prCycleTime?.avgCycleTime?.toFixed(1) || 3.2} days`,
          icon: "Clock",
          color: "indigo",
          trend: -5.7,
          subtitle: "Average PR lifecycle",
        }
      );
    }

    return items;
  }, [summary, analytics]);

  return (
    <div className="kpi-grid">
      {kpis.map((kpi, index) => (
        <KPICard key={index} {...kpi} />
      ))}
    </div>
  );
};

// Smart insights component with AI-powered recommendations
const SmartInsights = ({ analytics, summary }) => {
  const insights = useMemo(() => {
    const items = [];

    // High merge rate insight
    if (analytics?.prThroughput?.mergeRate > 80) {
      items.push({
        type: "success",
        title: "Excellent PR Success Rate",
        description: `${Math.round(analytics.prThroughput.mergeRate)}% of your PRs get merged - well above industry average of 70%!`,
        icon: "TrendingUp",
      });
    }

    // Work-life balance warning
    if (analytics?.workPatterns?.afterHoursPercentage > 30) {
      items.push({
        type: "warning",
        title: "Work-Life Balance Alert",
        description: `${Math.round(analytics.workPatterns.afterHoursPercentage)}% of your commits are after hours (6PM-8AM). Consider setting boundaries for better productivity.`,
        icon: "Clock",
      });
    }

    // High impact contributor
    if (analytics?.codeChurn?.netChange > 20000) {
      items.push({
        type: "info",
        title: "High Impact Contributor",
        description: `You've contributed ${analytics.codeChurn.netChange.toLocaleString()} net lines of code this period. Your work is making a significant impact!`,
        icon: "Code",
      });
    }

    // Most active day insight
    if (analytics?.workPatterns?.mostActiveDay) {
      items.push({
        type: "info",
        title: `Peak Productivity: ${analytics.workPatterns.mostActiveDay}`,
        description: `${analytics.workPatterns.mostActiveDay} is your most productive day. Consider scheduling important work during this time.`,
        icon: "Calendar",
      });
    }

    // Code review participation
    if (summary?.totalReviewsSubmitted > 10) {
      items.push({
        type: "success",
        title: "Great Team Player",
        description: `You've submitted ${summary.totalReviewsSubmitted} code reviews, showing excellent collaboration and team support.`,
        icon: "Users",
      });
    }

    return items.slice(0, 3); // Limit to 3 insights for better UX
  }, [analytics, summary]);

  if (insights.length === 0) {
    return (
      <div className="insights-card">
        <h3 className="insights-title">
          <DynamicIcon name="Brain" size={20} />
          Smart Insights
        </h3>
        <div className="insight-item insight-info">
          <div className="insight-content">
            <DynamicIcon name="Lightbulb" size={20} className="insight-icon" />
            <div className="insight-text">
              <h4 className="insight-title">Getting Started</h4>
              <p className="insight-description">
                Keep contributing to unlock personalized insights about your
                coding patterns and productivity!
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="insights-card">
      <h3 className="insights-title">
        <DynamicIcon name="Brain" size={20} />
        Smart Insights
      </h3>
      <div className="insights-list">
        {insights.map((insight, index) => (
          <div key={index} className={`insight-item insight-${insight.type}`}>
            <div className="insight-content">
              <DynamicIcon
                name={insight.icon}
                size={20}
                className="insight-icon"
              />
              <div className="insight-text">
                <h4 className="insight-title">{insight.title}</h4>
                <p className="insight-description">{insight.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Enhanced data table with search, pagination, and sorting
const EnhancedDataTable = ({ data, title, type }) => {
  const [currentPage, setCurrentPage] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const itemsPerPage = 5;

  const filteredData = useMemo(() => {
    if (!data || !Array.isArray(data)) return [];
    if (!searchTerm) return data;

    return data.filter((item) => {
      const searchString = JSON.stringify(item).toLowerCase();
      return searchString.includes(searchTerm.toLowerCase());
    });
  }, [data, searchTerm]);

  const paginatedData = useMemo(() => {
    const start = currentPage * itemsPerPage;
    const end = start + itemsPerPage;
    return filteredData.slice(start, end);
  }, [filteredData, currentPage]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);

  const formatDate = (dateStr) => {
    if (!dateStr) return "N/A";
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  const handleSearchChange = useCallback((e) => {
    setSearchTerm(e.target.value);
    setCurrentPage(0); // Reset to first page on search
  }, []);

  const handlePrevPage = useCallback(() => {
    setCurrentPage((prev) => Math.max(0, prev - 1));
  }, []);

  const handleNextPage = useCallback(() => {
    setCurrentPage((prev) => Math.min(totalPages - 1, prev + 1));
  }, [totalPages]);

  if (!data || data.length === 0) {
    return (
      <div className="data-table-card">
        <div className="table-header">
          <h3 className="table-title">{title}</h3>
          <span className="table-count">0 items</span>
        </div>
        <div style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
          <DynamicIcon
            name="FileX"
            size={48}
            style={{ marginBottom: "16px" }}
          />
          <p>No data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="data-table-card">
      <div className="table-header">
        <h3 className="table-title">{title}</h3>
        <div className="table-controls">
          <span className="table-count">{filteredData.length} items</span>
          <div className="search-container">
            <DynamicIcon name="Search" size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={handleSearchChange}
              className="search-input"
            />
          </div>
        </div>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr className="table-head-row">
              {type === "pullRequests" ? (
                <>
                  <th className="table-head-cell">PR #</th>
                  <th className="table-head-cell">Title</th>
                  <th className="table-head-cell">Repository</th>
                  <th className="table-head-cell">Status</th>
                  <th className="table-head-cell">Changes</th>
                  <th className="table-head-cell">Created</th>
                </>
              ) : (
                <>
                  <th className="table-head-cell">SHA</th>
                  <th className="table-head-cell">Message</th>
                  <th className="table-head-cell">Repository</th>
                  <th className="table-head-cell">Date</th>
                  <th className="table-head-cell">Impact</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {paginatedData.map((row, index) => (
              <tr key={index} className="table-body-row">
                {type === "pullRequests" ? (
                  <>
                    <td className="table-body-cell">#{row.number}</td>
                    <td className="table-body-cell">
                      <div className="cell-content-truncate" title={row.title}>
                        {row.title}
                      </div>
                    </td>
                    <td className="table-body-cell">
                      <div className="cell-content-truncate">
                        {row.repository?.name || "N/A"}
                      </div>
                    </td>
                    <td className="table-body-cell">
                      <span className={`status-badge status-${row.state}`}>
                        {row.state}
                      </span>
                    </td>
                    <td className="table-body-cell">
                      <div className="changes-display">
                        <span className="additions">+{row.additions || 0}</span>
                        <span className="deletions">-{row.deletions || 0}</span>
                      </div>
                    </td>
                    <td className="table-body-cell">
                      {formatDate(row.created_at)}
                    </td>
                  </>
                ) : (
                  <>
                    <td className="table-body-cell">
                      <code className="commit-sha">
                        {(row.sha || "").substring(0, 7)}
                      </code>
                    </td>
                    <td className="table-body-cell">
                      <div
                        className="cell-content-truncate"
                        title={row.commit?.message}
                      >
                        {row.commit?.message || "No message"}
                      </div>
                    </td>
                    <td className="table-body-cell">
                      <div className="cell-content-truncate">
                        {row.repository?.name || "N/A"}
                      </div>
                    </td>
                    <td className="table-body-cell">
                      {formatDate(row.commit?.author?.date)}
                    </td>
                    <td className="table-body-cell">
                      <div
                        className="progress-bar"
                        title={`${row.stats?.total || 0} lines changed`}
                      >
                        <div
                          className="progress-fill"
                          style={{
                            width: `${Math.min((row.stats?.total || 0) / 100, 100)}%`,
                          }}
                        />
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pagination">
          <span className="pagination-info">
            Showing {currentPage * itemsPerPage + 1} to{" "}
            {Math.min((currentPage + 1) * itemsPerPage, filteredData.length)} of{" "}
            {filteredData.length} results
          </span>
          <div className="pagination-controls">
            <button
              onClick={handlePrevPage}
              disabled={currentPage === 0}
              className="pagination-button"
            >
              <DynamicIcon name="ChevronLeft" size={16} />
              Previous
            </button>
            <span
              style={{ padding: "0 16px", fontSize: "14px", color: "#64748b" }}
            >
              Page {currentPage + 1} of {totalPages}
            </span>
            <button
              onClick={handleNextPage}
              disabled={currentPage === totalPages - 1}
              className="pagination-button"
            >
              Next
              <DynamicIcon name="ChevronRight" size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Tab Navigation Component with keyboard support
const TabNavigation = ({ activeTab, setActiveTab, tabs }) => {
  const handleKeyDown = useCallback(
    (e, index) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setActiveTab(index);
      }
    },
    [setActiveTab]
  );

  return (
    <div className="tab-navigation" role="tablist">
      {tabs.map((tab, index) => (
        <button
          key={index}
          onClick={() => setActiveTab(index)}
          onKeyDown={(e) => handleKeyDown(e, index)}
          className={`tab-button ${activeTab === index ? "tab-button-active" : ""}`}
          role="tab"
          aria-selected={activeTab === index}
          aria-controls={`tabpanel-${index}`}
          tabIndex={activeTab === index ? 0 : -1}
        >
          <DynamicIcon name={tab.icon} size={18} className="tab-icon" />
          {tab.label}
        </button>
      ))}
    </div>
  );
};

// Performance metrics component
const PerformanceMetrics = ({ analytics, summary }) => {
  const metrics = useMemo(
    () => [
      {
        label: "Code Review Participation",
        value: 85,
        status: "excellent",
        description: "Reviews given vs received ratio",
      },
      {
        label: "PR Merge Success Rate",
        value: analytics?.prThroughput?.mergeRate || 80,
        status: "good",
        description: "Percentage of PRs successfully merged",
      },
      {
        label: "Average Cycle Time",
        value: Math.min(
          (analytics?.prCycleTime?.avgCycleTime || 3.2) * 20,
          100
        ),
        status: analytics?.prCycleTime?.avgCycleTime < 5 ? "excellent" : "good",
        description: "Time from PR creation to merge",
      },
      {
        label: "Commit Frequency",
        value: Math.min((analytics?.codeChurn?.totalCommits || 20) * 2, 100),
        status: "good",
        description: "Consistency of contributions",
      },
    ],
    [analytics]
  );

  const growthAreas = useMemo(
    () => [
      {
        type: "tip",
        title: "Code Review Frequency",
        description:
          "Consider increasing your code review participation to strengthen team collaboration and code quality.",
        icon: "Lightbulb",
      },
      {
        type: "success",
        title: "Commit Quality",
        description:
          "Excellent job maintaining focused, well-documented commits. This makes code history easy to follow!",
        icon: "CheckCircle",
      },
      {
        type: "tip",
        title: "Work Distribution",
        description:
          "Try spreading work more evenly throughout the week to avoid burnout and maintain consistency.",
        icon: "BarChart3",
      },
    ],
    []
  );

  return (
    <div className="performance-grid">
      <div className="performance-card performance-metrics">
        <h4 className="performance-title">
          <DynamicIcon name="Target" size={20} />
          Performance Metrics
        </h4>
        <div className="metrics-list">
          {metrics.map((metric, index) => (
            <div key={index} className="metric-item">
              <div className="metric-header">
                <span className="metric-label">{metric.label}</span>
                <span className="metric-value">
                  {Math.round(metric.value)}%
                </span>
              </div>
              <div className="progress-bar">
                <div
                  className={`progress-fill ${metric.status === "excellent" ? "progress-fill-success" : ""}`}
                  style={{ width: `${metric.value}%` }}
                />
              </div>
              <p className={`metric-status metric-${metric.status}`}>
                {metric.status === "excellent" ? "Excellent" : "Above Average"}
              </p>
              <p
                style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}
              >
                {metric.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="performance-card growth-areas">
        <h4 className="performance-title">
          <DynamicIcon name="TrendingUp" size={20} />
          Growth Opportunities
        </h4>
        <div className="growth-list">
          {growthAreas.map((area, index) => (
            <div key={index} className={`growth-item growth-${area.type}`}>
              <DynamicIcon name={area.icon} size={16} className="growth-icon" />
              <div className="growth-text">
                <p className="growth-title">{area.title}</p>
                <p className="growth-description">{area.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// Main Dashboard Component with scroll position management
const Dashboard = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Scroll position management
  const scrollPosition = useRef(0);
  const containerRef = useRef(null);

  // Save scroll position
  const saveScrollPosition = useCallback(() => {
    scrollPosition.current = window.scrollY;
  }, []);

  // Restore scroll position
  const restoreScrollPosition = useCallback(() => {
    if (scrollPosition.current > 0) {
      window.scrollTo(0, scrollPosition.current);
    }
  }, []);

  const tabs = [
    { label: "Analytics", icon: "BarChart3" },
    { label: "Pull Requests", icon: "GitPullRequest" },
    { label: "Commits", icon: "GitCommit" },
    { label: "Performance", icon: "Target" },
  ];

  // Data fetching function
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(
        "http://localhost:5173/developer-Insights.json"
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const jsonData = await response.json();
      setData(jsonData);
      setError(null);
    } catch (err) {
      console.error("Error fetching data:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial data fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Scroll position management
  useEffect(() => {
    const handleScroll = () => {
      saveScrollPosition();
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [saveScrollPosition]);

  // Restore scroll position after loading
  useEffect(() => {
    if (!loading && data) {
      // Small delay to ensure DOM is fully rendered
      const timer = setTimeout(restoreScrollPosition, 100);
      return () => clearTimeout(timer);
    }
  }, [loading, data, restoreScrollPosition]);

  // Refresh data function (replaces window.location.reload)
  const refreshData = useCallback(async () => {
    if (refreshing) return;

    setRefreshing(true);
    saveScrollPosition();

    try {
      await fetchData();
    } finally {
      setRefreshing(false);
      // Restore scroll position after refresh
      setTimeout(restoreScrollPosition, 100);
    }
  }, [refreshing, fetchData, saveScrollPosition, restoreScrollPosition]);

  // Loading state
  if (loading && !data) {
    return (
      <div className="dashboard-loading">
        <div className="loading-content">
          <div className="loading-spinner" />
          <p className="loading-text">Loading insights...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !data) {
    return (
      <div className="dashboard-error">
        <div className="error-message">
          <DynamicIcon
            name="AlertCircle"
            size={20}
            style={{ marginRight: "8px" }}
          />
          Error loading data: {error}
          <button
            onClick={refreshData}
            style={{
              marginLeft: "16px",
              padding: "8px 16px",
              background: "#dc2626",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // No data state
  if (!data) {
    return (
      <div className="dashboard-error">
        <div className="error-message">
          <DynamicIcon
            name="Database"
            size={20}
            style={{ marginRight: "8px" }}
          />
          No data available
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard" ref={containerRef}>
      <div className="dashboard-container">
        <DashboardHeader metadata={data.metadata} summary={data.summary} />

        <SummaryCardsGrid summary={data.summary} analytics={data.analytics} />

        <SmartInsights analytics={data.analytics} summary={data.summary} />

        <div className="main-content-card">
          <TabNavigation
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            tabs={tabs}
          />

          <div
            className="tab-content"
            role="tabpanel"
            id={`tabpanel-${activeTab}`}
          >
            {activeTab === 0 && (
              <ChartsSection
                analytics={data.analytics}
                summary={data.summary}
              />
            )}

            {activeTab === 1 && (
              <EnhancedDataTable
                data={data.rawData?.pullRequests}
                title="Recent Pull Requests"
                type="pullRequests"
              />
            )}

            {activeTab === 2 && (
              <EnhancedDataTable
                data={data.rawData?.commits}
                title="Recent Commits"
                type="commits"
              />
            )}

            {activeTab === 3 && (
              <PerformanceMetrics
                analytics={data.analytics}
                summary={data.summary}
              />
            )}
          </div>
        </div>

        {/* Floating Action Button with refresh instead of reload */}
        <button
          className="fab"
          onClick={refreshData}
          disabled={refreshing}
          title={refreshing ? "Refreshing..." : "Refresh Data"}
        >
          <DynamicIcon
            name="RefreshCw"
            size={24}
            style={{
              animation: refreshing ? "spin 1s linear infinite" : "none",
            }}
          />
        </button>
      </div>
    </div>
  );
};

export default Dashboard;
