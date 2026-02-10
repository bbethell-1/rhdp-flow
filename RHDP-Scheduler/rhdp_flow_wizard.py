#!/usr/bin/env python3
"""
RHDP-Flow Interactive CSV Wizard (v2.0)
Generates workshop schedule CSV files through a guided CLI experience.

Requires: pip install rich
"""

import csv
import os
import random
import re
import string
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Dict, Optional

try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.prompt import Prompt, Confirm, IntPrompt
    from rich.table import Table
    from rich.text import Text
except ImportError:
    raise ImportError(
        "The wizard requires the 'rich' library. Install with: pip install rich>=13.0.0"
    )


class RHDPWizard:
    """Interactive wizard to generate workshop schedule CSV files."""

    CSV_HEADERS = [
        "CI Name", "CI", "Namespace", "Users", "Enable_workshop_interface",
        "Password", "Activity", "Purpose", "Workshop Name",
        "Provisioning Date (UTC)", "Auto-stop (UTC)", "Auto-destroy (UTC)",
        "Multi_Asset", "Asset_CIs", "Multi_Workshop_Name",
        "Concurrency", "Count", "AWS_Region", "White_Glove"
    ]

    def __init__(self, config=None):
        self.console = Console()
        self.config = config
        self.workshops: List[Dict[str, str]] = []

    def run(self):
        """Main wizard entry point."""
        self.console.print(Panel.fit(
            "[bold cyan]RHDP-Flow Workshop Scheduler Wizard[/bold cyan]\n"
            "Generate workshop schedule CSV files interactively.",
            border_style="cyan"
        ))

        while True:
            workshop = self._collect_workshop()
            self.workshops.append(workshop)

            self.console.print("\n[green]Workshop configured![/green]")
            if not Confirm.ask("Add another workshop?", default=False):
                break

        self._preview_csv()
        self._save_csv()

    def _collect_workshop(self) -> Dict[str, str]:
        """Collect all fields for a single workshop."""
        self.console.print("\n[bold]--- New Workshop ---[/bold]")

        # 1. Catalog Item
        ci = self._select_ci()
        ci_name = self._get_ci_display_name(ci)

        # 2. Users
        users = IntPrompt.ask("Number of users", default=20)

        # 3. Namespace
        namespace = self._select_namespace()

        # 4. Workshop UI
        enable_ui = Confirm.ask("Enable Workshop UI?", default=True)

        # 5. Workshop Name
        default_name = f"{ci_name} - {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
        workshop_name = Prompt.ask("Workshop Name", default=default_name)

        # 6. Dates
        prov_date, stop_date, destroy_date = self._collect_dates()

        # 7. Password
        password = self._collect_password()

        # 8. Activity & Purpose
        activity = Prompt.ask("Activity", default="Admin")
        purpose = Prompt.ask("Purpose", default="QA")

        # 9. Advanced options
        concurrency = "1"
        count = "1"
        aws_region = ""
        multi_asset = "False"
        asset_cis = ""
        multi_workshop_name = ""
        white_glove = "False"

        if Confirm.ask("Configure advanced options? (count, concurrency, regions, multi-asset)", default=False):
            concurrency = str(IntPrompt.ask("Deployment concurrency", default=1))
            count = str(IntPrompt.ask("Number of instances (Count)", default=1))

            if Confirm.ask("Configure AWS regions? (multi-region provisioning)", default=False):
                aws_region = Prompt.ask(
                    "AWS regions (comma-separated, e.g., us-east-1,eu-west-1)",
                    default=""
                )

            if Confirm.ask("Is this a multi-asset workshop? (old-style comma-separated CIs)", default=False):
                multi_asset = "True"
                asset_cis = Prompt.ask("Asset CIs (comma-separated)")
                multi_workshop_name = Prompt.ask("Multi-Workshop Name", default="")

            if Confirm.ask("White-glove engagement?", default=False):
                white_glove = "True"

        return {
            "CI Name": ci_name,
            "CI": ci,
            "Namespace": namespace,
            "Users": str(users),
            "Enable_workshop_interface": str(enable_ui),
            "Password": password,
            "Activity": activity,
            "Purpose": purpose,
            "Workshop Name": workshop_name,
            "Provisioning Date (UTC)": prov_date,
            "Auto-stop (UTC)": stop_date,
            "Auto-destroy (UTC)": destroy_date,
            "Multi_Asset": multi_asset,
            "Asset_CIs": asset_cis,
            "Multi_Workshop_Name": multi_workshop_name,
            "Concurrency": concurrency,
            "Count": count,
            "AWS_Region": aws_region,
            "White_Glove": white_glove,
        }

    def _select_ci(self) -> str:
        """Select a Catalog Item, optionally querying the cluster."""
        self.console.print("\n[bold]Select Catalog Item:[/bold]")

        choices = []
        if self.config and not self.config.dry_run:
            choices = self._query_catalog_items()

        if choices:
            table = Table(title="Available Catalog Items", show_lines=False)
            table.add_column("#", style="cyan", width=4)
            table.add_column("Catalog Item", style="white")
            table.add_column("Display Name", style="green")

            for i, (ci_id, display) in enumerate(choices[:20], 1):
                table.add_row(str(i), ci_id, display)

            self.console.print(table)
            selection = Prompt.ask(
                "Enter number or type custom CI",
                default="1"
            )

            try:
                idx = int(selection) - 1
                if 0 <= idx < len(choices):
                    return choices[idx][0]
            except ValueError:
                pass
            return selection.strip()
        else:
            return Prompt.ask("Enter Catalog Item ID (e.g., openshift-cnv.ocp-virt-roadshow-multi-user.prod)")

    def _query_catalog_items(self) -> List[tuple]:
        """Query cluster for available catalog items."""
        try:
            cmd = [
                self.config.oc_command, "get", "catalogitem",
                "-n", "babylon-catalog-prod",
                "-o", "jsonpath={range .items[*]}{.metadata.name}|{.metadata.annotations.babylon\\.gpte\\.redhat\\.com/catalogItemDisplayName}\\n{end}"
            ]
            env = os.environ.copy()
            if self.config.kubeconfig_path:
                env['KUBECONFIG'] = self.config.kubeconfig_path

            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, env=env)
            if result.returncode == 0:
                items = []
                for line in result.stdout.strip().split('\n'):
                    if '|' in line:
                        parts = line.split('|', 1)
                        items.append((parts[0].strip(), parts[1].strip() if len(parts) > 1 else parts[0].strip()))
                return sorted(items, key=lambda x: x[1])
        except Exception:
            pass
        return []

    def _get_ci_display_name(self, ci: str) -> str:
        """Get display name for a CI, querying cluster if possible."""
        if self.config and not self.config.dry_run:
            try:
                catalog_ns = "babylon-catalog-event" if ci.endswith(".event") else "babylon-catalog-prod"
                cmd = [
                    self.config.oc_command, "get", "catalogitem", ci,
                    "-n", catalog_ns,
                    "-o", "jsonpath={.metadata.annotations.babylon\\.gpte\\.redhat\\.com/catalogItemDisplayName}"
                ]
                env = os.environ.copy()
                if self.config.kubeconfig_path:
                    env['KUBECONFIG'] = self.config.kubeconfig_path
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=15, env=env)
                if result.returncode == 0 and result.stdout.strip():
                    return result.stdout.strip()
            except Exception:
                pass
        return Prompt.ask("CI Display Name", default=ci)

    def _select_namespace(self) -> str:
        """Select or enter a namespace."""
        self.console.print("\n[bold]Namespace:[/bold]")

        # Try to detect current namespace
        current_ns = ""
        if self.config:
            try:
                cmd = [self.config.oc_command, "project", "-q"]
                env = os.environ.copy()
                if self.config.kubeconfig_path:
                    env['KUBECONFIG'] = self.config.kubeconfig_path
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=10, env=env)
                if result.returncode == 0:
                    current_ns = result.stdout.strip()
            except Exception:
                pass

        if current_ns:
            self.console.print(f"  Current namespace: [cyan]{current_ns}[/cyan]")
            if Confirm.ask(f"Use {current_ns}?", default=True):
                return current_ns

        return Prompt.ask("Enter namespace (e.g., user-bbethell-redhat-com)")

    def _collect_dates(self) -> tuple:
        """Collect provisioning, stop, and destroy dates."""
        self.console.print("\n[bold]Scheduling (all times in UTC):[/bold]")

        now = datetime.now(timezone.utc)

        # Provisioning date
        default_prov = (now + timedelta(hours=1)).strftime("%d/%m/%Y %H:%M")
        prov_date = Prompt.ask("Provisioning Date (DD/MM/YYYY HH:MM)", default=default_prov)

        # Parse provisioning to suggest stop/destroy
        try:
            prov_dt = datetime.strptime(prov_date.strip(), "%d/%m/%Y %H:%M").replace(tzinfo=timezone.utc)
        except ValueError:
            prov_dt = now + timedelta(hours=1)

        # Auto-stop (suggested: provision + 8 hours)
        default_stop = (prov_dt + timedelta(hours=8)).strftime("%d/%m/%Y %H:%M")
        self.console.print(f"  [dim]Suggested auto-stop: {default_stop} (provision + 8h)[/dim]")
        stop_date = Prompt.ask("Auto-stop (DD/MM/YYYY HH:MM, or 'none')", default=default_stop)
        if stop_date.lower() == 'none':
            stop_date = ""

        # Auto-destroy (suggested: provision + 2 days)
        default_destroy = (prov_dt + timedelta(days=2)).strftime("%d/%m/%Y %H:%M")
        self.console.print(f"  [dim]Suggested auto-destroy: {default_destroy} (provision + 2d)[/dim]")
        destroy_date = Prompt.ask("Auto-destroy (DD/MM/YYYY HH:MM)", default=default_destroy)

        return prov_date, stop_date, destroy_date

    def _collect_password(self) -> str:
        """Collect or generate a password."""
        if Confirm.ask("Generate a secure password?", default=True):
            password = self._generate_password()
            self.console.print(f"  Generated: [bold green]{password}[/bold green]")
            return password
        return Prompt.ask("Enter password")

    @staticmethod
    def _generate_password(length: int = 8) -> str:
        """Generate a simple, readable password."""
        # Mix of letters and digits, easy to type
        chars = string.ascii_letters + string.digits
        return ''.join(random.choices(chars, k=length))

    def _preview_csv(self):
        """Show a preview of the generated CSV as a rich table."""
        self.console.print("\n")
        table = Table(title="CSV Preview", show_lines=True, expand=True)

        # Show key columns only for readability
        preview_cols = ["CI Name", "CI", "Namespace", "Users", "Workshop Name",
                        "Provisioning Date (UTC)", "Password"]
        for col in preview_cols:
            table.add_column(col, overflow="fold")

        for ws in self.workshops:
            table.add_row(*[ws.get(col, "") for col in preview_cols])

        self.console.print(table)
        self.console.print(f"\n[dim]Total workshops: {len(self.workshops)}[/dim]")

    def _save_csv(self):
        """Save workshops to a CSV file."""
        default_file = "workshop_schedule.csv"
        filepath = Prompt.ask("Save to file", default=default_file)

        with open(filepath, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=self.CSV_HEADERS)
            writer.writeheader()
            for ws in self.workshops:
                writer.writerow(ws)

        self.console.print(f"\n[bold green]CSV saved to: {filepath}[/bold green]")
        self.console.print(f"Run with: [cyan]python3 rhdp_flow.py --input-csv {filepath}[/cyan]")
        self.console.print(f"Preview:  [cyan]python3 rhdp_flow.py --input-csv {filepath} --dry-run[/cyan]")


if __name__ == "__main__":
    # Allow running wizard standalone
    import sys
    sys.path.insert(0, str(Path(__file__).parent))
    from rhdp_flow import RHDPConfig

    config = RHDPConfig()
    wizard = RHDPWizard(config)
    wizard.run()
