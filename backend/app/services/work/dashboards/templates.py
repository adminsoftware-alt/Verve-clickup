"""Ready-made Dashboards. Each card is (type, title, config, width, height)."""

from typing import Any, Dict, List, Tuple

Card = Tuple[str, str, Dict[str, Any], int, int]

WEEK = {"preset": "this_week"}


def _cards(template: str) -> List[Card]:
    if template == "simple":
        return [
            ("calculation", "Open tasks", {}, 3, 1),
            ("calculation", "Due today", {"filters": {"due": "today"}}, 3, 1),
            ("calculation", "Overdue", {"filters": {"due": "overdue"}}, 3, 1),
            ("calculation", "Done this week", {"filters": {"done": "this_week"}}, 3, 1),
            ("pie", "Workload by status", {"group_by": "status"}, 6, 3),
            ("bar", "Open tasks by assignee", {"group_by": "assignee"}, 6, 3),
            ("task_list", "Due in the next 7 days", {"filters": {"due": "next_7_days"}}, 6, 3),
            ("task_list", "Overdue tasks", {"filters": {"due": "overdue"}}, 6, 3),
        ]
    if template == "vapl_review":
        # Verve's "Creating a Comprehensive Dashboard" SOP, card for card.
        return [
            ("calculation", "Total tasks", {}, 3, 1),
            ("calculation", "Overdue tasks", {"filters": {"due": "overdue"}}, 3, 1),
            ("calculation", "Unassigned tasks", {"filters": {"assignees": ["none"]}}, 3, 1),
            ("calculation", "Tasks without estimates", {"filters": {"estimate": "missing"}}, 3, 1),
            ("pie", "Workload by status", {"group_by": "status"}, 6, 3),
            ("task_list", "Work done today", {"filters": {"done": "today"}}, 6, 3),
            ("time_report", "Timesheet of all assignees",
             {"period": WEEK, "time_group_by": "user", "then_by": "task", "include_subtasks": True}, 12, 3),
            ("task_list", "Overdue tasks", {"filters": {"due": "overdue"}}, 6, 3),
            ("task_list", "Tasks without estimates", {"filters": {"estimate": "missing"}}, 6, 3),
            ("calculation", "Unscheduled tasks", {"filters": {"scheduled": "no"}}, 3, 1),
            ("task_list", "Unassigned tasks", {"filters": {"assignees": ["none"]}}, 9, 3),
            ("task_list", "Unscheduled tasks", {"filters": {"scheduled": "no"}}, 12, 3),
            ("portfolio", "Actual vs budgeted time by List", {"include_subtasks": True}, 12, 3),
        ]
    if template == "time_tracking":
        return [
            ("timesheet", "Timesheet this week", {"period": WEEK, "include_subtasks": True}, 12, 3),
            ("time_report", "Time by person", {"period": {"preset": "this_month"}, "time_group_by": "user",
                                               "then_by": "task", "include_subtasks": True}, 6, 3),
            ("time_report", "Billable time by List", {"period": {"preset": "this_month"}, "time_group_by": "list",
                                                       "then_by": "task", "billable": "billable",
                                                       "include_subtasks": True}, 6, 3),
            ("calculation", "Tracked on open tasks", {"measure": "time_tracked", "fn": "sum"}, 4, 1),
            ("calculation", "Estimated on open tasks", {"measure": "time_estimate", "fn": "sum"}, 4, 1),
            ("calculation", "Tasks without estimates", {"filters": {"estimate": "missing"}}, 4, 1),
            ("portfolio", "Estimated vs tracked by List", {"include_subtasks": True}, 12, 3),
        ]
    return []


def template_cards(template: str, sources: List[Dict[str, Any]]) -> List[Card]:
    return [(kind, title, {**config, "sources": sources}, w, h) for kind, title, config, w, h in _cards(template)]
