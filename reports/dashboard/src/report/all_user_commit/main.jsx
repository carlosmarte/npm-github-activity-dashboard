import React, { useState, useEffect, useMemo, useCallback } from "react";
import * as Icons from "lucide-react";
// import { gitHubCommitData } from "./Data.mjs";
import "./main.css";

// Enhanced Icon component with error handling
const DynamicIcon = ({ name, className, size = 20, ...props }) => {
  const IconComponent = Icons[name];
  if (!IconComponent || typeof IconComponent !== "function") {
    return <Icons.HelpCircle size={size} className={className} {...props} />;
  }
  return <IconComponent size={size} className={className} {...props} />;
};

// Enhanced Header Component
const DashboardHeader = ({ data }) => {
  if (!data) return null;

  const formatDate = (dateStr) => {
    if (!dateStr) return "N/A";
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="dashboard-header">
      <div className="header-content">
        <div className="header-main">
          <h1 className="dashboard-title">GitHub User Commit Analysis</h1>
          <h2 className="user-title">
            User: {data.inputs?.searchUser || "Unknown"}
          </h2>
        </div>
        <div className="header-badges">
          <span className="badge badge-info">
            <DynamicIcon name="Calendar" size={16} />
            {formatDate(data.summary?.dateRange?.earliest)} -{" "}
            {formatDate(data.summary?.dateRange?.latest)}
          </span>
          <span className="badge badge-success">
            <DynamicIcon name="Clock" size={16} />
            Generated: {formatDate(data.inputs?.generatedAt)}
          </span>
          <span className="badge badge-warning">
            <DynamicIcon name="Database" size={16} />
            Records: {data.inputs?.totalRecords || 0}
          </span>
        </div>
      </div>
    </div>
  );
};

// Enhanced Summary Cards Component
const SummaryCardsGrid = ({ data }) => {
  const summaryCards = useMemo(() => {
    if (!data?.summary) return [];

    const summary = data.summary;
    return [
      {
        title: "Total Commits",
        value: summary.totalCommits || 0,
        icon: "GitCommit",
        color: "blue",
        subtitle: `${summary.directCommits || 0} direct, ${summary.pullRequestCommits || 0} PR`,
      },
      {
        title: "Repositories",
        value: summary.uniqueRepositories || 0,
        icon: "Folder",
        color: "purple",
        subtitle: "Unique repos contributed to",
      },
      {
        title: "Lines Added",
        value: (summary.totalAdditions || 0).toLocaleString(),
        icon: "Plus",
        color: "green",
        subtitle: `${(summary.totalDeletions || 0).toLocaleString()} deleted`,
      },
      {
        title: "Files Changed",
        value: summary.totalFilesChanged || 0,
        icon: "FileEdit",
        color: "orange",
        subtitle: "Across all commits",
      },
      {
        title: "Success Rate",
        value: `${Math.round(((summary.totalCommits || 0) / (data.inputs?.totalRecords || 1)) * 100)}%`,
        icon: "TrendingUp",
        color: "indigo",
        subtitle: "Processing efficiency",
      },
      {
        title: "Net Changes",
        value: (summary.totalAdditions || 0) - (summary.totalDeletions || 0),
        icon: "BarChart3",
        color:
          (summary.totalAdditions || 0) > (summary.totalDeletions || 0)
            ? "green"
            : "red",
        subtitle: "Total additions - deletions",
      },
    ];
  }, [data]);

  return (
    <div className="summary-grid">
      {summaryCards.map((card, index) => (
        <div key={index} className={`summary-card summary-card-${card.color}`}>
          <div className="summary-content">
            <div className="summary-info">
              <p className="summary-title">{card.title}</p>
              <p className="summary-value">{card.value}</p>
              {card.subtitle && (
                <p className="summary-subtitle">{card.subtitle}</p>
              )}
            </div>
            <div className={`summary-icon summary-icon-${card.color}`}>
              <DynamicIcon name={card.icon} size={24} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

// Enhanced KPI Cards Component
const KPICardsGrid = ({ filteredCommits, totalCommits }) => {
  const kpis = useMemo(() => {
    if (!filteredCommits || filteredCommits.length === 0) return [];

    const totalLines = filteredCommits.reduce(
      (acc, commit) => acc + (commit.stats?.total || 0),
      0
    );
    const totalAdditions = filteredCommits.reduce(
      (acc, commit) => acc + (commit.stats?.additions || 0),
      0
    );
    const totalDeletions = filteredCommits.reduce(
      (acc, commit) => acc + (commit.stats?.deletions || 0),
      0
    );
    const uniqueRepos = new Set(filteredCommits.map((c) => c.repository)).size;
    const avgCommitSize =
      filteredCommits.length > 0 ? totalLines / filteredCommits.length : 0;

    const getCommitFrequencyColor = (count) => {
      if (count >= 10) return "green";
      if (count >= 5) return "yellow";
      return "red";
    };

    const getCommitSizeColor = (size) => {
      if (size <= 50) return "green";
      if (size <= 200) return "yellow";
      return "red";
    };

    const getRepoCountColor = (count) => {
      if (count >= 3) return "green";
      if (count >= 2) return "yellow";
      return "red";
    };

    return [
      {
        title: "Commit Frequency",
        value: filteredCommits.length,
        icon: "Activity",
        color: getCommitFrequencyColor(filteredCommits.length),
        subtitle: `${Math.round((filteredCommits.length / totalCommits) * 100)}% of total`,
      },
      {
        title: "Avg Commit Size",
        value: Math.round(avgCommitSize),
        icon: "BarChart2",
        color: getCommitSizeColor(avgCommitSize),
        subtitle: "Lines changed per commit",
      },
      {
        title: "Repository Spread",
        value: uniqueRepos,
        icon: "GitBranch",
        color: getRepoCountColor(uniqueRepos),
        subtitle: "Repositories involved",
      },
      {
        title: "Code Impact",
        value: `+${totalAdditions.toLocaleString()}/-${totalDeletions.toLocaleString()}`,
        icon: "Code",
        color: totalAdditions > totalDeletions ? "green" : "red",
        subtitle: "Lines added/removed",
      },
    ];
  }, [filteredCommits, totalCommits]);

  return (
    <div className="kpi-grid">
      {kpis.map((kpi, index) => (
        <div key={index} className={`kpi-card kpi-card-${kpi.color}`}>
          <div className="kpi-content">
            <div className="kpi-info">
              <p className="kpi-title">{kpi.title}</p>
              <p className="kpi-value">{kpi.value}</p>
              {kpi.subtitle && <p className="kpi-subtitle">{kpi.subtitle}</p>}
            </div>
            <div className={`kpi-icon kpi-icon-${kpi.color}`}>
              <DynamicIcon name={kpi.icon} size={24} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

// Enhanced Commits Table Component
const CommitsTable = ({ commits, onFilterChange }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilterType, setDateFilterType] = useState("");
  const [dateRange, setDateRange] = useState({ start: "", end: "" });
  const [currentPage, setCurrentPage] = useState(0);
  const [sortConfig, setSortConfig] = useState({
    key: "date",
    direction: "desc",
  });
  const [expandedMessages, setExpandedMessages] = useState(new Set());
  const itemsPerPage = 10;

  // Filter and sort commits
  const filteredAndSortedCommits = useMemo(() => {
    let filtered = commits || [];

    // Text search
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (commit) =>
          commit.message?.toLowerCase().includes(searchLower) ||
          commit.repository?.toLowerCase().includes(searchLower) ||
          commit.author?.toLowerCase().includes(searchLower)
      );
    }

    // Date filtering
    if (dateFilterType && dateRange.start && dateRange.end) {
      const startDate = new Date(dateRange.start);
      const endDate = new Date(dateRange.end);
      endDate.setHours(23, 59, 59, 999); // Include the entire end date

      filtered = filtered.filter((commit) => {
        const commitDate = new Date(commit.date);
        return commitDate >= startDate && commitDate <= endDate;
      });
    }

    // Sorting
    filtered.sort((a, b) => {
      let aVal = a[sortConfig.key];
      let bVal = b[sortConfig.key];

      if (sortConfig.key === "date") {
        aVal = new Date(aVal);
        bVal = new Date(bVal);
      } else if (sortConfig.key === "stats.total") {
        aVal = a.stats?.total || 0;
        bVal = b.stats?.total || 0;
      } else if (sortConfig.key === "repository") {
        aVal = (aVal || "").toLowerCase();
        bVal = (bVal || "").toLowerCase();
      } else if (sortConfig.key === "message") {
        aVal = (aVal || "").toLowerCase();
        bVal = (bVal || "").toLowerCase();
      }

      if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [commits, searchTerm, dateFilterType, dateRange, sortConfig]);

  // Notify parent of filter changes
  useEffect(() => {
    onFilterChange(filteredAndSortedCommits);
  }, [filteredAndSortedCommits, onFilterChange]);

  // Pagination
  const paginatedCommits = useMemo(() => {
    const start = currentPage * itemsPerPage;
    return filteredAndSortedCommits.slice(start, start + itemsPerPage);
  }, [filteredAndSortedCommits, currentPage]);

  const totalPages = Math.ceil(filteredAndSortedCommits.length / itemsPerPage);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(0);
  }, [searchTerm, dateFilterType, dateRange]);

  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  const toggleMessageExpansion = (index) => {
    setExpandedMessages((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  const formatDate = (dateStr) => {
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  const makeLinksClickable = (text) => {
    if (!text) return text;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.split(urlRegex).map((part, index) => {
      if (urlRegex.test(part)) {
        return (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="table-link"
          >
            {part}
          </a>
        );
      }
      return part;
    });
  };

  const renderSortableHeader = (key, label) => {
    const isActive = sortConfig.key === key;
    const direction = isActive ? sortConfig.direction : null;

    return (
      <th
        onClick={() => handleSort(key)}
        className={`sortable ${isActive ? "active" : ""}`}
      >
        <div className="sort-header">
          <span>{label}</span>
          <DynamicIcon
            name={
              direction === "asc"
                ? "ChevronUp"
                : direction === "desc"
                  ? "ChevronDown"
                  : "ArrowUpDown"
            }
            size={14}
            className="sort-icon"
          />
        </div>
      </th>
    );
  };

  return (
    <div className="table-container">
      <div className="table-header">
        <h3 className="table-title">Commit Activity</h3>

        <div className="filter-controls">
          <div className="search-container">
            <DynamicIcon name="Search" size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search commits, repositories, or authors..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>

          <select
            value={dateFilterType}
            onChange={(e) => setDateFilterType(e.target.value)}
            className="filter-select"
          >
            <option value="">No date filter</option>
            <option value="date">Filter by commit date</option>
          </select>

          {dateFilterType && (
            <div className="date-range-container">
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) =>
                  setDateRange((prev) => ({ ...prev, start: e.target.value }))
                }
                className="date-input"
              />
              <span>to</span>
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) =>
                  setDateRange((prev) => ({ ...prev, end: e.target.value }))
                }
                className="date-input"
              />
            </div>
          )}
        </div>

        {dateFilterType && dateRange.start && dateRange.end && (
          <div className="active-filter">
            <DynamicIcon name="Calendar" size={16} />
            Date range: {dateRange.start} to {dateRange.end}
          </div>
        )}
      </div>

      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              {renderSortableHeader("sha", "SHA")}
              {renderSortableHeader("message", "Message")}
              {renderSortableHeader("repository", "Repository")}
              {renderSortableHeader("date", "Date")}
              {renderSortableHeader("stats.total", "Changes")}
              <th>Link</th>
            </tr>
          </thead>
          <tbody>
            {paginatedCommits.map((commit, index) => {
              const globalIndex = currentPage * itemsPerPage + index;
              const isExpanded = expandedMessages.has(globalIndex);
              const message = commit.message || "";
              const shouldTruncate = message.length > 100;

              return (
                <tr key={commit.sha || index}>
                  <td>
                    <code className="commit-sha">
                      {commit.sha?.substring(0, 7) || "N/A"}
                    </code>
                  </td>
                  <td>
                    <div
                      className={`commit-message ${isExpanded ? "expanded" : ""}`}
                    >
                      {makeLinksClickable(
                        isExpanded || !shouldTruncate
                          ? message
                          : `${message.substring(0, 100)}...`
                      )}
                      {shouldTruncate && (
                        <button
                          onClick={() => toggleMessageExpansion(globalIndex)}
                          className="expand-button"
                        >
                          {isExpanded ? "Show less" : "Show more"}
                        </button>
                      )}
                    </div>
                  </td>
                  <td>{commit.repository?.split("/").pop() || "N/A"}</td>
                  <td>{formatDate(commit.date)}</td>
                  <td>
                    <div className="changes-display">
                      <span className="additions">
                        +{commit.stats?.additions || 0}
                      </span>
                      <span className="deletions">
                        -{commit.stats?.deletions || 0}
                      </span>
                    </div>
                  </td>
                  <td>
                    {commit.url && (
                      <a
                        href={commit.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="table-link"
                        title="View commit on GitHub"
                      >
                        <DynamicIcon name="ExternalLink" size={16} />
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="pagination">
        <span className="pagination-info">
          Showing {currentPage * itemsPerPage + 1} to{" "}
          {Math.min(
            (currentPage + 1) * itemsPerPage,
            filteredAndSortedCommits.length
          )}{" "}
          of {filteredAndSortedCommits.length} results
        </span>
        <div className="pagination-controls">
          <button
            onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
            disabled={currentPage === 0}
            className="pagination-button"
          >
            <DynamicIcon name="ChevronLeft" size={16} />
            Previous
          </button>
          <span className="page-info">
            {currentPage + 1} of {Math.max(1, totalPages)}
          </span>
          <button
            onClick={() =>
              setCurrentPage(Math.min(totalPages - 1, currentPage + 1))
            }
            disabled={currentPage >= totalPages - 1}
            className="pagination-button"
          >
            Next
            <DynamicIcon name="ChevronRight" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

// Enhanced Risk Assessment Component
const RiskAssessment = ({ data }) => {
  const risks = useMemo(() => {
    if (!data?.commits) return [];

    const commits = data.commits;
    const riskItems = [];

    // Large commit risk
    const largeCommits = commits.filter((c) => (c.stats?.total || 0) > 200);
    if (largeCommits.length > 0) {
      riskItems.push({
        severity: "High",
        title: "Large Commits Detected",
        description: `${largeCommits.length} commits have >200 line changes. Consider breaking down large changes into smaller, more focused commits.`,
        icon: "AlertTriangle",
      });
    }

    // Repository concentration risk
    const uniqueRepos = new Set(commits.map((c) => c.repository)).size;
    if (uniqueRepos === 1) {
      riskItems.push({
        severity: "Medium",
        title: "Single Repository Focus",
        description:
          "All commits are concentrated in one repository. Consider diversifying contributions across multiple projects.",
        icon: "GitBranch",
      });
    }

    // Commit frequency analysis
    const dates = commits.map((c) => new Date(c.date)).sort((a, b) => a - b);
    const daysBetween =
      dates.length > 1
        ? (dates[dates.length - 1] - dates[0]) / (1000 * 60 * 60 * 24)
        : 0;
    const avgCommitsPerDay = commits.length / Math.max(daysBetween, 1);

    if (avgCommitsPerDay < 0.1 && commits.length > 5) {
      riskItems.push({
        severity: "Low",
        title: "Irregular Commit Pattern",
        description:
          "Long time gaps between commits detected. Consider establishing a more regular contribution schedule.",
        icon: "Clock",
      });
    }

    // Very small commits risk
    const tinyCommits = commits.filter((c) => (c.stats?.total || 0) < 5);
    if (tinyCommits.length > commits.length * 0.5) {
      riskItems.push({
        severity: "Medium",
        title: "Many Small Commits",
        description: `${tinyCommits.length} commits have <5 line changes. Consider combining related small changes.`,
        icon: "Minimize",
      });
    }

    return riskItems;
  }, [data]);

  if (risks.length === 0) {
    return (
      <div className="risk-container">
        <h3 className="risk-title">
          <DynamicIcon name="Shield" size={20} />
          Risk Assessment
        </h3>
        <div className="risk-item risk-success">
          <DynamicIcon name="CheckCircle" size={20} className="risk-icon" />
          <div>
            <h4>No Major Risks Detected</h4>
            <p>
              Commit patterns appear healthy and well-distributed. Good
              practices detected in repository contributions.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="risk-container">
      <h3 className="risk-title">
        <DynamicIcon name="Shield" size={20} />
        Risk Assessment
      </h3>
      {risks.map((risk, index) => (
        <div
          key={index}
          className={`risk-item risk-${risk.severity.toLowerCase()}`}
        >
          <DynamicIcon name={risk.icon} size={20} className="risk-icon" />
          <div>
            <h4>
              <span
                className={`severity-badge severity-${risk.severity.toLowerCase()}`}
              >
                {risk.severity}
              </span>
              {risk.title}
            </h4>
            <p>{risk.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
};

// Enhanced Formula Display Component
const FormulaDisplay = ({ formulas }) => {
  const parseFormula = (formula) => {
    const equalIndex = formula.indexOf(" = ");
    if (equalIndex === -1) {
      const colonIndex = formula.indexOf(": ");
      if (colonIndex !== -1) {
        const name = formula.substring(0, colonIndex);
        const rest = formula.substring(colonIndex + 2);

        if (rest.includes("(") && rest.includes(")")) {
          const ranges = rest.split(", ").map((range) => {
            const parenIndex = range.indexOf("(");
            if (parenIndex !== -1) {
              return {
                type: "range",
                name: range.substring(0, parenIndex).trim(),
                range: range.substring(parenIndex),
              };
            }
            return { type: "text", value: range };
          });

          return { name, ranges };
        }

        return { name, formula: rest };
      }
      return { name: formula, formula: "" };
    }

    const name = formula.substring(0, equalIndex);
    const formulaText = formula.substring(equalIndex + 3);
    return { name, formula: formulaText };
  };

  if (!formulas || formulas.length === 0) {
    return (
      <div className="formula-container">
        <h3 className="formula-title">
          <DynamicIcon name="Calculator" size={20} />
          Calculation Formulas
        </h3>
        <div className="formula-item">
          <span className="formula-name">Default Metrics</span>
          <span className="formula-text">
            Standard GitHub commit analysis calculations
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="formula-container">
      <h3 className="formula-title">
        <DynamicIcon name="Calculator" size={20} />
        Calculation Formulas
      </h3>
      <div className="formula-list">
        {formulas.map((formula, index) => {
          const parsed = parseFormula(formula);

          return (
            <div key={index} className="formula-item">
              <span className="formula-name">{parsed.name}</span>
              {parsed.formula && (
                <span className="formula-text">{parsed.formula}</span>
              )}
              {parsed.ranges && (
                <div className="formula-ranges">
                  {parsed.ranges.map((range, i) => (
                    <div key={i} className="formula-range">
                      {range.name && (
                        <span className="range-name">{range.name}</span>
                      )}
                      {range.range && (
                        <span className="range-value">{range.range}</span>
                      )}
                      {range.value && (
                        <span className="range-text">{range.value}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Main Dashboard Component
const Dashboard = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filteredCommits, setFilteredCommits] = useState([]);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        // Simulate API call delay
        fetch("/all_user_commit.json")
          .then((res) => res.json())
          .then((gitHubCommitData) => {
            setData(gitHubCommitData);
            setFilteredCommits(gitHubCommitData.commits || []);
            setError(null);
          });
      } catch (err) {
        console.error("Error loading data:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const handleFilterChange = useCallback((filtered) => {
    setFilteredCommits(filtered);
  }, []);

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="loading-content">
          <div className="loading-spinner" />
          <p className="loading-text">Loading GitHub activity data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-error">
        <div className="error-message">
          <DynamicIcon name="AlertCircle" size={20} />
          Error loading data: {error}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="dashboard-error">
        <div className="error-message">
          <DynamicIcon name="Database" size={20} />
          No data available
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="dashboard-container">
        <DashboardHeader data={data} />
        <SummaryCardsGrid data={data} />
        <KPICardsGrid
          filteredCommits={filteredCommits}
          totalCommits={data.commits?.length || 0}
        />
        <CommitsTable
          commits={data.commits}
          onFilterChange={handleFilterChange}
        />
        <div className="bottom-sections">
          <RiskAssessment data={data} />
          <FormulaDisplay formulas={data.formula} />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
