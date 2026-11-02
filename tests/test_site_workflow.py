"""The site's workflow (.github/workflows/site.yml) records the demo, builds it, puts the site together and deploys it to GitHub
Pages, with the least permissions: read as text, as no YAML reader is among the project's packages. A run of it needs GitHub, so the
shape of the file is what is checked here."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "site.yml"


def _text() -> str:
    return WORKFLOW.read_text(encoding="utf-8")


def _code(text: str | None = None) -> str:
    """The workflow without its comment lines: what it does."""
    return "\n".join(line for line in (text or _text()).splitlines() if not line.lstrip().startswith("#"))


def _jobs() -> dict[str, str]:
    body = _code().split("\njobs:\n", 1)[1]
    jobs: dict[str, list[str]] = {}
    name = None
    for line in body.splitlines():
        found = re.fullmatch(r"  ([a-z][a-z0-9_-]*):\s*", line)
        if found:
            name = found.group(1)
            jobs[name] = []
        elif name:
            jobs[name].append(line)
    return {name: "\n".join(lines) for name, lines in jobs.items()}


def _in_order(text: str, *steps: str) -> None:
    at = 0
    for step in steps:
        assert step in text[at:], step
        at = text.index(step, at) + len(step)


def test_it_runs_for_a_push_to_main_that_touches_the_site_and_by_hand_and_for_nothing_else():
    code = _code()
    on = code.split("\non:\n", 1)[1].split("\npermissions:", 1)[0]
    assert re.findall(r"^  ([a-z_]+):", on, flags=re.MULTILINE) == ["push", "workflow_dispatch"]
    assert re.search(r"^    branches: \[main\]$", on, flags=re.MULTILINE)
    paths = re.findall(r"^      - '([^']+)'$", on, flags=re.MULTILINE)
    assert {"site/**", "web/**", "tools/record-site-demo.py"} <= set(paths)
    assert "pull_request" not in code and "tags" not in on


def test_the_build_can_read_and_the_deploy_job_alone_can_write_to_pages():
    code = _code()
    top = code.split("\npermissions:\n", 1)[1].split("\nconcurrency:", 1)[0]
    assert [line.strip() for line in top.splitlines() if line.strip()] == ["contents: read"]
    jobs = _jobs()
    assert set(jobs) == {"build", "deploy"}
    build_permissions = jobs["build"].split("permissions:\n", 1)[1].split("steps:", 1)[0]
    assert [line.strip() for line in build_permissions.splitlines() if line.strip()] == ["contents: read"]
    assert "write" not in jobs["build"] and "id-token" not in jobs["build"]
    deploy_permissions = jobs["deploy"].split("permissions:\n", 1)[1].split("environment:", 1)[0]
    assert [line.strip() for line in deploy_permissions.splitlines() if line.strip()] == ["pages: write", "id-token: write"]
    assert code.count("pages: write") == 1 and code.count("id-token: write") == 1
    assert "run:" not in jobs["deploy"] and "uses: actions/deploy-pages@" in jobs["deploy"]  # the job that can write runs no script of ours


def test_the_workflow_holds_no_secret_and_keeps_no_credentials():
    text = _text()
    assert "secrets." not in text and "GITHUB_TOKEN" not in text and "GH_TOKEN" not in text
    code = _code()
    assert code.count("persist-credentials: false") == code.count("uses: actions/checkout@") == 2
    assert not re.search(r"\bgh\s|git push|git commit|guild-board-releases", code)


def test_every_action_is_pinned_to_the_commit_of_its_version():
    code = _code()
    uses = re.findall(r"^\s*(?:- )?uses: (\S+) # (v\d+\.\d+\.\d+)$", code, flags=re.MULTILINE)
    assert len(uses) == len(re.findall(r"uses:", code)) == 7, "every use names its version in a comment"
    assert {action for action, _ in uses} == {
        "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
        "astral-sh/setup-uv@c7f87aa956e4c323abf06d5dec078e358f6b4d04",
        "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
        "actions/configure-pages@983d7736d9b0ae728b81ab479565c72886d7745b",
        "actions/upload-pages-artifact@56afc609e74202658d3ffba0e8f6dda462b719fa",
        "actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e",
    }
    assert ("actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683", "v4.2.2") in uses
    assert ("astral-sh/setup-uv@c7f87aa956e4c323abf06d5dec078e358f6b4d04", "v6.0.0") in uses
    assert ("actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020", "v4.4.0") in uses
    assert ("actions/configure-pages@983d7736d9b0ae728b81ab479565c72886d7745b", "v5.0.0") in uses
    assert ("actions/upload-pages-artifact@56afc609e74202658d3ffba0e8f6dda462b719fa", "v3.0.1") in uses
    assert ("actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e", "v4.0.5") in uses


def test_the_build_records_builds_assembles_and_keeps_the_site_in_order():
    build = _jobs()["build"]
    assert "runs-on: windows-latest" in build
    _in_order(
        build,
        "uses: actions/checkout@",
        "ref: site-assets",
        "steps.pictures.outcome == 'failure'",
        "uses: astral-sh/setup-uv@",
        "uses: actions/setup-node@",
        "uv sync --frozen",
        "npm ci --prefix web",
        "tools/record-site-demo.py",
        "npm run build:site-demo --prefix web",
        "tools/assemble-site.py",
        "uses: actions/upload-pages-artifact@",
    )
    assemble = re.search(r"run: (uv run [^\n]*assemble-site\.py[^\n]*)", build).group(1)
    assert "--demo web/dist-site" in assemble and "--shots site-assets/shots" in assemble and "--require-all" in assemble
    assert "path: _site" in build and "--out _site" in assemble


def test_a_missing_screenshots_branch_fails_the_build_with_a_plain_sentence():
    build = _jobs()["build"]
    checkout = build.split("id: pictures", 1)[1].split("- name:", 1)[0]
    assert "continue-on-error: true" in checkout and "ref: site-assets" in checkout and "path: site-assets" in checkout
    stop = build.split("steps.pictures.outcome == 'failure'", 1)[1].split("- name:", 1)[0]
    assert "The branch site-assets does not exist, so the site has no screenshots." in stop
    assert "a site without its pictures is no site" in stop and "exit 1" in stop


def test_the_deploy_goes_to_the_github_pages_environment_after_the_build():
    deploy = _jobs()["deploy"]
    assert "needs: build" in deploy and "name: github-pages" in deploy
    assert "url: ${{ steps.deployment.outputs.page_url }}" in deploy and "id: deployment" in deploy
    _in_order(deploy, "uses: actions/configure-pages@", "uses: actions/deploy-pages@")
    # Pages' address and the demo's base agree: the site is served from /guild-board/, and the demo is built for /guild-board/demo/.
    assert "SITE_DEMO_BASE = '/guild-board/demo/'" in (ROOT / "web" / "vite.config.ts").read_text(encoding="utf-8")
