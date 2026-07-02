# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Purpose

This repository contains Claude Skills for equity investors and traders. Each skill packages domain-specific prompts, knowledge bases, and helper scripts to assist with market analysis, technical charting, economic calendar monitoring, and trading strategy development. Skills are designed to work in both Claude's web app and Claude Code environments.

⚠️ **Important:** Some skills require paid API subscriptions (FMP API and/or FINVIZ Elite) to function. See the [API Key Management](#api-key-management) section for detailed requirements by skill.

## Repository Architecture

### Skill Structure

Each skill follows a standardized directory structure:

```
<skill-name>/
├── SKILL.md              # Required: Skill definition with YAML frontmatter
├── references/           # Knowledge bases loaded into Claude's context
├── scripts/             # Executable Python scripts (not auto-loaded)
└── assets/              # Templates and resources for output generation
```

**SKILL.md Format:**
- YAML frontmatter with `name` and `description` fields
- `name` must match the directory name for proper skill detection
- Description defines when the skill should be triggered
- Body contains workflow instructions written in imperative/infinitive form
- All instructions assume Claude will execute them, not the user

**Progressive Loading:**
1. Metadata (YAML frontmatter) loads first for skill detection
2. SKILL.md body loads when skill is invoked
3. References load conditionally based on analysis needs
4. Scripts execute on demand, never auto-loaded into context

### Key Design Patterns

**Knowledge Base Organization:**
- `references/` contains markdown files with domain knowledge (sector rotation patterns, technical analysis frameworks, news source credibility guides)
- Knowledge bases provide context without requiring Claude to have specialized training
- References are read selectively during skill execution to minimize token usage

**Script vs. Reference Division:**
- Scripts (`scripts/`) are executable code for API calls, data fetching, report generation
- References (`references/`) are documentation for Claude to read and apply
- Scripts handle I/O; references handle knowledge

**Output Generation:**
- Skills generate reports (markdown + JSON) saved to `reports/` directory
- Filename convention: `<skill>_<analysis-type>_<date>.md` (and `.json`)
- Reports use structured templates from `assets/` directories
- Scripts should default `--output-dir` to `reports/` (or pass `--output-dir reports/` when invoking)

## Common Development Tasks

Moved to **[docs/dev/development-tasks.md](docs/dev/development-tasks.md)** — read it when you need:
skill creation / packaging / docs generation, API-key setup per provider
(FMP, FINVIZ, Alpaca…), per-skill CLI usage examples, or the
skill-improvement pipeline and its tests.

## Skill Interaction Patterns & Multi-Skill Workflows

Moved to **[docs/dev/skill-interactions-and-workflows.md](docs/dev/skill-interactions-and-workflows.md)**.
The authoritative workflow definitions are `workflows/*.yaml` (see
`workflows/README.md`); `skills-index.yaml` is the single source of truth for
skill metadata. Use the `trading-skills-navigator` skill to pick a workflow.

## Important Conventions

### SKILL.md Writing Style

- Use imperative/infinitive verb forms (e.g., "Analyze the chart", "Generate report")
- Write instructions for Claude to execute, not user instructions
- Avoid phrases like "You should..." or "Claude will..." - just state actions directly
- Structure: Overview → When to Use → Workflow → Output Format → Resources

### Reference Document Patterns

- Knowledge bases use declarative statements of fact
- Include historical examples and case studies
- Provide decision frameworks and checklists
- Organize hierarchically (H2 for major sections, H3 for subsections)

### Analysis Output Requirements

All analysis outputs must:
- Be saved to the `reports/` directory (create if it does not exist)
- Include date/time stamps
- Use English language
- Provide probability assessments where applicable
- Include specific trigger levels for actionable scenarios
- Cite references to knowledge base sources

### Error Handling in Scripts

Scripts should:
- Check for API keys before making requests
- Validate date ranges and input parameters
- Provide helpful error messages to stderr
- Return proper exit codes (0 for success, 1 for errors)
- Support retry logic with exponential backoff for rate limits

### No Personal Information in Committed Files

This is a **public repository**. Never hardcode personal information:
- **Absolute paths** containing usernames (e.g., `/Users/username/...`) — use relative paths or dynamic resolution like `Path(__file__).resolve().parents[N]`
- **API keys / secrets** — use environment variables (`$FMP_API_KEY`, `$FINVIZ_API_KEY`) or `.gitignore`-listed config files (`.mcp.json`, `.envrc`)
- **Usernames, email addresses, or other PII**

Files that contain secrets (`.mcp.json`, `.envrc`) must be listed in `.gitignore` and never committed.

## Language Considerations

- All SKILL.md files are in English
- Analysis outputs are in English
- Some reference materials (Stanley Druckenmiller Investment) include Japanese content
- README files available in both English (README.md) and Japanese (README.ja.md)
- User interactions may be in Japanese; analysis outputs remain in English

## Distribution Workflow

When skills are ready for distribution:

1. Test skill thoroughly in Claude Code
2. Package skill with the repo packager, which excludes tests and local build artifacts:
   ```bash
   python3 scripts/package_skills.py --skill <skill-name>
   ```
3. Confirm the generated `.skill` file is in `skill-packages/`
4. Update README.md and README.ja.md with skill description
   - **Important:** Clearly indicate if the skill requires API subscriptions (FMP, FINVIZ Elite)
   - Include pricing information and sign-up links for required APIs
   - Specify if APIs are required, optional, or not needed
5. Commit changes with descriptive message

ZIP packages allow Claude web app users to upload and use skills without cloning the repository.

⚠️ **API Key Requirements in Distribution:**
- When distributing skills that require API keys, clearly document the requirements in the skill's SKILL.md
- Include setup instructions for both environment variables and command-line arguments
- Provide links to API registration and pricing pages
- Distinguish between required APIs (skill won't work without) and optional APIs (enhances performance)
