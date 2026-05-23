# Step 1: Fork opencode and Scaffold the Monorepo

**Goal:** Get a Bun workspaces monorepo set up with the existing TUI moved into `packages/tui/`, ready to receive opencode's packages.

**Prerequisites:** [Step 0](00-prerequisites.md) complete.

---

## 1.1 Fork opencode on GitHub

```bash
gh repo fork anomalyco/opencode --clone=false
```

This creates `<your-username>/opencode` on GitHub. We will not clone it directly — instead, we'll cherry-pick the packages we need.

## 1.2 Clone opencode locally as reference

Put it somewhere outside your monkeyDcode repo:

```bash
cd ~/Code
git clone https://github.com/<your-username>/opencode.git opencode-fork
```

## 1.3 Restructure monkeyDcode into a Bun workspaces monorepo

From `/home/rohan-prasen/Code/monkeyDcode`:

### Create package directories
```bash
mkdir -p packages/{tui/src,agent/src/{sub-agents,prompts},consistency/src/{verification,model-capability},context/src,python-bridge/src,engine/src,llm/src,core/src}
mkdir -p scripts
```

### Move existing TUI code
```bash
mv src/index.tsx packages/tui/src/index.tsx
rmdir src
```

### Update root `package.json`
Replace the contents with:
```json
{
    "name": "monkeydcode",
    "private": true,
    "workspaces": ["packages/*"],
    "scripts": {
        "dev": "bun run --filter @monkeydcode/tui dev",
        "build": "bun run --filter '*' build",
        "typecheck": "bun run --filter '*' typecheck",
        "test": "bun run --filter '*' test"
    },
    "devDependencies": {
        "@types/bun": "latest",
        "typescript": "^5.8.0"
    }
}
```

### Create `tsconfig.base.json` at the repo root
```json
{
    "compilerOptions": {
        "lib": ["ESNext"],
        "target": "ESNext",
        "module": "Preserve",
        "moduleDetection": "force",
        "allowJs": true,
        "moduleResolution": "bundler",
        "allowImportingTsExtensions": true,
        "verbatimModuleSyntax": true,
        "noEmit": true,
        "strict": true,
        "skipLibCheck": true,
        "noFallthroughCasesInSwitch": true,
        "noUncheckedIndexedAccess": true,
        "noImplicitOverride": true
    }
}
```

### Create `packages/tui/package.json`
```json
{
    "name": "@monkeydcode/tui",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "module": "src/index.tsx",
    "scripts": {
        "dev": "bun run --watch src/index.tsx",
        "typecheck": "tsc --noEmit"
    },
    "dependencies": {
        "@opentui/core": "^0.2.10",
        "@opentui/react": "^0.2.10",
        "react": "^19.2.6"
    },
    "devDependencies": {
        "@types/bun": "latest"
    }
}
```

### Create `packages/tui/tsconfig.json`
```json
{
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
        "jsx": "react-jsx",
        "jsxImportSource": "@opentui/react"
    },
    "include": ["src"]
}
```

### Delete the old `tsconfig.json` at the root
```bash
rm tsconfig.json
```

### Install dependencies
```bash
bun install
```

## 1.4 Verify the move worked

```bash
cd packages/tui
bun run dev
```

You should see the OpenTUI "What will you build?" screen. Press Ctrl+C to quit.

```bash
cd ../..
bun run --filter @monkeydcode/tui typecheck
```

Should pass with zero errors.

## 1.5 Update `.gitignore`

Append:
```
# Workspaces
packages/**/node_modules

# Python tooling
tools/.venv
tools/__pycache__
tools/**/__pycache__

# SQLite session DBs
*.db
*.db-journal
*.db-wal
*.db-shm
```

## 1.6 Create skeleton package.json files

Each empty package needs a stub. Example for `packages/agent/package.json`:
```json
{
    "name": "@monkeydcode/agent",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "main": "src/index.ts",
    "scripts": { "typecheck": "tsc --noEmit", "test": "bun test" },
    "dependencies": {
        "@monkeydcode/consistency": "workspace:*",
        "@monkeydcode/context": "workspace:*",
        "@monkeydcode/engine": "workspace:*",
        "@monkeydcode/llm": "workspace:*"
    }
}
```

Do the same for: `consistency`, `context`, `python-bridge`, `engine`, `llm`, `core` (adjust deps).

Each gets a `tsconfig.json`:
```json
{
    "extends": "../../tsconfig.base.json",
    "include": ["src"]
}
```

## 1.7 Initial commit

```bash
git add -A
git status   # review
git commit -m "chore: scaffold Bun workspaces monorepo"
```

## What You Have Now

```
monkeyDcode/
├── package.json                # Workspace root
├── tsconfig.base.json
├── packages/
│   ├── tui/                    # Working
│   ├── agent/                  # Skeleton
│   ├── consistency/            # Skeleton
│   ├── context/                # Skeleton
│   ├── python-bridge/          # Skeleton
│   ├── engine/                 # Skeleton — fills in step 3
│   ├── llm/                    # Skeleton — fills in step 2
│   └── core/                   # Skeleton — fills in step 2
├── tools/                      # Existing Python package
├── docs/
├── plan/
└── scripts/                    # Empty
```

## Next Step

[Step 2: Adopt the LLM package from opencode](02-adopt-llm-package.md)
