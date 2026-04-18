# About Me
I am a product leader, not a developer. I understand architecture and product deeply but do not read code. Always communicate with me accordingly.

# Communication Style
- Explain what you are doing and why in plain conversational English as you work
- Avoid technical jargon, bash command narration, and developer-speak
- Talk to me like a smart colleague explaining their work, not a developer logging their terminal session
- When you hit a problem, explain what the problem is and how you plan to solve it in plain English before diving in
- Never show me code in your explanations unless I specifically ask for it

# Project Setup
- Database: Neon Postgres via DATABASE_URL environment variable — never create a local or alternative database
- Auth: Google OAuth via environment variables — never implement a different auth system
- All secrets come from environment variables — never hardcode credentials

# Server and Port Management

## This Project's Assigned Ports
- **Backend (API):** 3002 (set in `.env` as `PORT`)
- **Frontend (Vite dev server):** 5175 (set in `.env` as `VITE_PORT`)

These ports are pinned. Do not change them casually — other projects on this machine are assigned different ports to avoid conflicts. If you need to change them, update `.env` AND this CLAUDE.md together.

**Never kill servers belonging to other projects.** You may restart this project's servers on ports 3002 and 5175, but leave anything on other ports alone.

# How to Start a Session
- Read this CLAUDE.md fully before doing anything
- Understand the current state of the codebase before making any changes
- Ask me what I want to work on if it isn't clear

# How to Work
- Before starting any significant task, briefly explain your plan in plain English and confirm I'm aligned
- Work autonomously once I've confirmed — don't check in constantly for small decisions
- If you hit something unexpected that changes the plan significantly, stop and tell me in plain English before proceeding
- Never consider a task done until you've completed the quality checks below

# Quality Checks — Run After Every Task
- Review the code you wrote for quality, bugs, and security issues
- Check that your changes integrate cleanly with the existing architecture
- Run all available tests and fix any failures before telling me you're done
- Confirm that nothing you changed broke something that was already working
- Done. Here's exactly what I added as a new bullet under **Quality Checks — Run After Every Task**:
- **CRITICAL: After ANY backend change (server/, shared/schema.ts, or anything that affects the server), you MUST restart the dev server to pick up the changes. The tsx runtime does NOT auto-reload — changes are NOT picked up until the server is manually restarted. Never assume the server will detect changes on its own.**
- Report what you found in plain English before marking the task complete

# Definition of Done
A task is not done until:
- All features in the spec are implemented — review the original request line by line
- Quality checks above are complete
- No known bugs or broken tests
- You have told me what you built, what you checked, and anything I should know

# Git
- Always make sure .env and .env.* are in .gitignore before committing anything
- Never commit secrets or credentials
- Write clear commit messages in plain English describing what changed and why

# Worktree Safety
When working in a git worktree (any directory under .claude/worktrees/), ALL file reads, edits, writes, and glob/grep operations MUST use paths within the worktree directory — never the main repo at /Users/landonray/Coding Projects/[current_project].

Before editing any file, verify your working directory is the worktree, not main. If you detect you've edited a file in the main repo while a worktree is active, stop immediately and report the error.

When dispatching subagents, always include the full absolute worktree path in the prompt and explicitly instruct the subagent to work only within that path.
