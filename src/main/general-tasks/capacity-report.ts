// Available inside the isolated writer workspace. The summary, status and table all use the same rows.
const capacityReportPython = String.raw`"""Render a passive HTML capacity summary and table from one JSON list of role-weeks."""
import json
import sys
from decimal import Decimal, DecimalException, Inexact, localcontext
from html import escape


def label(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("role, week and project labels must be nonempty strings")
    return value.strip()


def hours(value):
    if not isinstance(value, Decimal) or not value.is_finite() or value < 0:
        raise ValueError("hours must be nonnegative JSON numbers")
    return value


def display(value):
    if value == 0:
        return "0"
    if abs(value.adjusted()) > 24:
        return str(value)
    result = format(value, "f")
    return result.rstrip("0").rstrip(".") if "." in result else result


def render(records):
    if not isinstance(records, list) or not records:
        raise ValueError("provide at least one role-week")
    rows = []
    overloaded = unknown = 0
    seen = set()
    for record in records:
        role, week = label(record["role"]), label(record["week"])
        if (role, week) in seen:
            raise ValueError("combine assignments for each role-week into a single row")
        seen.add((role, week))
        capacity = None if record["capacity"] is None else hours(record["capacity"])
        tasks = record["assignments"]
        if not isinstance(tasks, list):
            raise ValueError("assignments must be a list")
        assignments = [(label(task["project"]), hours(task["hours"])) for task in tasks]
        assigned = sum((amount for _, amount in assignments), Decimal(0))
        remaining = None if capacity is None else capacity - assigned
        if remaining is None:
            unknown += 1
            status = "Capacity unknown"
        elif remaining < 0:
            overloaded += 1
            status = "Over by " + display(-remaining) + " h"
        elif remaining == 0:
            status = "At capacity"
        else:
            status = display(remaining) + " h available"
        breakdown = ", ".join(escape(name) + " (" + display(amount) + " h)" for name, amount in assignments)
        cells = [escape(role), escape(week), breakdown or "None listed", display(assigned),
                 display(capacity) if capacity is not None else "Unknown",
                 display(remaining) if remaining is not None else "Unknown", status]
        rows.append("<tr><th scope=\"row\">" + cells[0] + "</th>" +
                    "".join("<td>" + cell + "</td>" for cell in cells[1:]) + "</tr>")
    assessed = len(rows) - unknown
    summary = "Overloaded role-weeks: " + str(overloaded) + " of " + str(assessed) + " assessed."
    if unknown:
        summary += " Role-weeks with unknown capacity: " + str(unknown) + "."
    headers = ["Role", "Week", "Project assignments", "Assigned hours", "Capacity hours", "Remaining hours", "Status"]
    return ("<p>" + summary + "</p><table><caption>Capacity by role and week</caption><thead><tr>" +
            "".join('<th scope="col">' + heading + "</th>" for heading in headers) +
            "</tr></thead><tbody>" + "".join(rows) + "</tbody></table>")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: python3 tools/soar_capacity.py role-weeks.json")
    try:
        with open(sys.argv[1], encoding="utf-8") as source, localcontext() as ctx:
            ctx.traps[Inexact] = True
            records = json.load(source, parse_float=Decimal, parse_int=Decimal)
            fragment = render(records)
        print(fragment)
    except (DecimalException, KeyError, TypeError, ValueError, OSError) as error:
        sys.exit("Cannot render capacity report: " + str(error))
`;

export const capacityReportGuidance = `For an hours-based staffing or capacity report, transcribe each supplied role-week once as a JSON list of {"role":string,"week":string,"capacity":number|null,"assignments":[{"project":string,"hours":number}]}. Use null for undisclosed capacity. Compare these inputs with the source. Run python3 tools/soar_capacity.py <json-file> and embed its HTML fragment in the requested page. It generates the summary, row totals and available or excess hours from the same assignments. Use those results for any recommendations. Keep intermediate files outside output/.`;

export function capacityReportFile(): { path: string; bytes: Buffer } {
  return { path: "tools/soar_capacity.py", bytes: Buffer.from(capacityReportPython, "utf8") };
}
