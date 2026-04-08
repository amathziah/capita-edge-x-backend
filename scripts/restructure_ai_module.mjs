/**
 * AI Module Restructure Script
 * Moves flat ai/ files into grouped subdirectories and fixes all import paths.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AI_DIR = path.join(__dirname, '../src/modules/ai');

// ── File → group/name mapping ────────────────────────────────────────────────
const FILE_MAP = {
    'ai.controller.js':          { group: 'controllers', name: 'ai.controller.js' },
    'aiChat.controller.js':      { group: 'controllers', name: 'chat.controller.js' },
    'aiHistory.controller.js':   { group: 'controllers', name: 'history.controller.js' },
    'aiOps.controller.js':       { group: 'controllers', name: 'ops.controller.js' },
    'aiController.shared.js':    { group: 'controllers', name: 'shared.js' },

    'ai.service.js':             { group: 'core', name: 'ai.service.js' },
    'aiOrchestrator.service.js': { group: 'core', name: 'orchestrator.service.js' },
    'aiGrounding.service.js':    { group: 'core', name: 'grounding.service.js' },
    'aiRuntime.service.js':      { group: 'core', name: 'runtime.service.js' },
    'aiStructuredTask.service.js': { group: 'core', name: 'structuredTask.service.js' },

    'aiEnhancedIntent.service.js': { group: 'intent', name: 'enhanced.service.js' },
    'aiIntent.service.js':         { group: 'intent', name: 'basic.service.js' },
    'aiEmbeddingIntent.service.js':{ group: 'intent', name: 'embedding.service.js' },
    'aiQueryParser.service.js':    { group: 'intent', name: 'queryParser.service.js' },

    'aiReadModel.service.js':    { group: 'workspace', name: 'readModel.service.js' },
    'aiToolRegistry.service.js': { group: 'workspace', name: 'toolRegistry.service.js' },
    'aiGuidedDesk.service.js':   { group: 'workspace', name: 'guidedDesk.service.js' },

    'aiAgent.service.js':        { group: 'agent', name: 'agent.service.js' },
    'aiSessionManager.service.js': { group: 'agent', name: 'session.service.js' },

    'aiSemanticSearch.service.js': { group: 'search', name: 'semantic.service.js' },

    'aiActionExecutor.service.js': { group: 'actions', name: 'executor.service.js' },
    'aiActionRegistry.service.js': { group: 'actions', name: 'registry.service.js' },

    'aiCaching.service.js':      { group: 'infra', name: 'cache.service.js' },
    'aiCache.service.js':        { group: 'infra', name: 'responseCache.service.js' },
    'aiBudget.service.js':       { group: 'infra', name: 'budget.service.js' },
    'aiDeduplication.service.js':{ group: 'infra', name: 'deduplication.service.js' },
    'aiModelRouter.service.js':  { group: 'infra', name: 'modelRouter.service.js' },
    'aiTrace.service.js':        { group: 'infra', name: 'trace.service.js' },
};

// Reverse lookup: old basename → { group, name }
const OLD_TO_NEW = new Map(
    Object.entries(FILE_MAP).map(([oldName, dest]) => [oldName, dest])
);

// Resolve new import path from source group to target file
function resolveNewImport(sourceGroup, oldImportPath) {
    // Strip leading ./
    const bare = oldImportPath.replace(/^\.\//, '');
    const dest = OLD_TO_NEW.get(bare);
    if (!dest) return null; // not an internal AI file

    if (sourceGroup === 'root') {
        // ai.route.js importing from subdir
        return `./${dest.group}/${dest.name}`;
    }
    if (dest.group === sourceGroup) {
        // Same group → same directory
        return `./${dest.name}`;
    }
    // Different group → go up one then into target group
    return `../${dest.group}/${dest.name}`;
}

// Fix depth of non-AI imports when file moves one level deeper
function fixDepth(importPath, sourceGroup) {
    if (sourceGroup === 'root') return importPath; // ai.route.js stays at root, no depth change
    // ../../core/ → ../../../core/
    if (importPath.startsWith('../../core/')) return importPath.replace('../../core/', '../../../core/');
    // ../analytics/ → ../../analytics/
    if (importPath.startsWith('../analytics/')) return importPath.replace('../analytics/', '../../analytics/');
    // ../../core/... (catch-all for anything starting ../../)
    if (importPath.startsWith('../../')) return importPath.replace('../../', '../../../');
    return importPath;
}

function rewriteImports(content, sourceGroup) {
    // Match: import ... from 'PATH'  or  } from 'PATH'
    return content.replace(/from\s+'([^']+)'/g, (match, importPath) => {
        // Internal AI file reference
        if (importPath.startsWith('./ai') || importPath.startsWith('./ai.')) {
            const newPath = resolveNewImport(sourceGroup, importPath);
            if (newPath) return `from '${newPath}'`;
        }
        // Depth fix for external imports
        const fixed = fixDepth(importPath, sourceGroup);
        if (fixed !== importPath) return `from '${fixed}'`;
        return match;
    });
}

// ── Step 1: Create subdirectories ────────────────────────────────────────────
const groups = ['controllers', 'core', 'intent', 'workspace', 'agent', 'search', 'actions', 'infra'];
for (const g of groups) {
    const dir = path.join(AI_DIR, g);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Step 2: Copy + rewrite each file ────────────────────────────────────────
let moved = 0;
for (const [oldName, { group, name }] of Object.entries(FILE_MAP)) {
    const srcPath = path.join(AI_DIR, oldName);
    const destPath = path.join(AI_DIR, group, name);
    if (!fs.existsSync(srcPath)) {
        console.warn(`  SKIP (not found): ${oldName}`);
        continue;
    }
    let content = fs.readFileSync(srcPath, 'utf8');
    content = rewriteImports(content, group);
    fs.writeFileSync(destPath, content, 'utf8');
    console.log(`  ✓ ${oldName} → ${group}/${name}`);
    moved++;
}

// ── Step 3: Fix ai.route.js (stays at root, only controller path changes) ───
const routePath = path.join(AI_DIR, 'ai.route.js');
let routeContent = fs.readFileSync(routePath, 'utf8');
routeContent = rewriteImports(routeContent, 'root');
fs.writeFileSync(routePath, routeContent, 'utf8');
console.log('  ✓ ai.route.js (updated controller import)');

// ── Step 4: Fix server.js (embedding intent path) ────────────────────────────
const serverPath = path.join(__dirname, '../src/server.js');
let serverContent = fs.readFileSync(serverPath, 'utf8');
serverContent = serverContent.replace(
    `'./modules/ai/aiEmbeddingIntent.service.js'`,
    `'./modules/ai/intent/embedding.service.js'`
);
fs.writeFileSync(serverPath, serverContent, 'utf8');
console.log('  ✓ server.js (updated embedding intent path)');

// ── Step 5: Delete old flat files ────────────────────────────────────────────
let deleted = 0;
for (const oldName of Object.keys(FILE_MAP)) {
    const oldPath = path.join(AI_DIR, oldName);
    if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
        deleted++;
    }
}

console.log(`\nDone. Moved: ${moved}, Deleted originals: ${deleted}`);
