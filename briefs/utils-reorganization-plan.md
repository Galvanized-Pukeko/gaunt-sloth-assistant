# Utility Files Reorganization Plan

## Overview
This document outlines a phased approach to reorganize utility files in the Gaunt Sloth Assistant codebase over 5 releases to reduce risk and maintain backward compatibility.

## Current State Analysis

### Existing Utility Files
1. **`src/utils.ts`** (342 lines)
   - File I/O operations
   - Date/string formatting utilities
   - Tool formatting functions
   - Process spawning utilities
   - Version management
   - Hook execution

2. **`src/systemUtils.ts`** (215 lines)
   - Process/stdin/stdout management
   - Install/project directory paths
   - Console wrappers (log, error, warn, info, debug)
   - Log stream management
   - TTY and color settings
   - Escape key handling

3. **`src/pathUtils.ts`** (134 lines)
   - Gsloth directory management
   - Configuration file path resolution
   - Output file path resolution

4. **`src/globalConfigUtils.ts`** (72 lines)
   - Global .gsloth directory in home
   - OAuth storage paths
   - Global auth directory management

5. **`src/consoleUtils.ts`** (140 lines)
   - ANSI color formatting
   - Session logging
   - Display functions (error, warning, success, info)
   - Status callback implementation

6. **`src/debugUtils.ts`** (93 lines)
   - Debug log file management
   - Debug logging functions
   - Object inspection utilities

7. **`src/cliUtils.ts`** (90 lines)
   - CLI option parsing
   - Boolean/string value coercion

8. **`src/llmUtils.ts`** (16 lines)
   - LLM runnable configuration

9. **`src/commands/commandUtils.ts`** (85 lines)
   - Provider management
   - Requirements/content provider logic

### Key Problems Identified
- **Overlapping functionality**: File I/O spread across multiple files
- **Unclear boundaries**: Path utilities mixed with config logic
- **Scattered logging**: Three different logging systems
- **Circular dependency risks**: Files importing each other
- **Poor discoverability**: Hard to find where functionality lives

## Reorganization Plan by Release

### Release 1: File I/O Consolidation
**Risk Level:** Low  
**Breaking Changes:** None (backward compatibility maintained)

#### Actions:
1. Create `src/fileUtils.ts` containing:
   ```typescript
   // From utils.ts
   - readFileFromProjectDir()
   - readFileFromInstallDir()
   - writeFileIfNotExistsWithMessages()
   - appendToFile()
   - readFileSyncWithMessages()
   - readMultipleFilesFromProjectDir()
   - importExternalFile()
   - importFromFilePath()
   
   // From systemUtils.ts
   - initLogStream()
   - writeToLogStream()
   - closeLogStream()
   ```

#### Testing:
- Verify all existing tests pass
- Add unit tests for new `fileUtils.ts` module
- Test backward compatibility exports

---

### Release 2: Path Utilities Consolidation
**Risk Level:** Low-Medium  
**Breaking Changes:** None (deprecation warnings added)

#### Actions:
1. Enhance `src/pathUtils.ts` with:
   ```typescript
   // From globalConfigUtils.ts (entire file)
   - getGlobalGslothDir()
   - ensureGlobalGslothDir()
   - getGlobalAuthDir()
   - ensureGlobalAuthDir()
   - getOAuthStoragePath()
   
   // From systemUtils.ts
   - getProjectDir()
   - getInstallDir()
   - setEntryPoint()
   
   // From utils.ts
   - toFileSafeString()
   - fileSafeLocalDate()
   - generateStandardFileName()
   ```

2. Mark `globalConfigUtils.ts` as deprecated
3. Update imports in affected files
4. Maintain re-exports for compatibility

#### Testing:
- Test all path resolution functions
- Verify OAuth storage paths work correctly
- Check configuration file discovery

---

### Release 3: Console/Logging Consolidation
**Risk Level:** Medium  
**Breaking Changes:** None (unified API introduced)

#### Actions:
1. Create unified logging in enhanced `src/consoleUtils.ts`:
   ```typescript
   // Merge in from debugUtils.ts
   - initDebugLogging()
   - debugLog()
   - debugLogMultiline()
   - debugLogObject()
   - debugLogError()
   
   // From systemUtils.ts
   - log(), error(), warn(), info(), debug(), stream()
   
   // Keep existing
   - Session logging functions
   - ANSI color utilities
   - Display functions
   ```

2. Create unified configuration interface:
   ```typescript
   interface LogConfig {
     enableDebug: boolean;
     enableSession: boolean;
     debugFile?: string;
     sessionFile?: string;
     useColor: boolean;
   }
   ```

3. Deprecate `debugUtils.ts`
4. Update all logging calls to use unified system

#### Testing:
- Test all log levels work correctly
- Verify debug and session logs are created
- Test color output in TTY and non-TTY modes

---

### Release 4: Provider & Command Utilities
**Risk Level:** Medium  
**Breaking Changes:** None

#### Actions:
1. Create `src/providers/providerUtils.ts`:
   ```typescript
   // Move from commandUtils.ts
   - REQUIREMENTS_PROVIDERS constant
   - CONTENT_PROVIDERS constant
   - getRequirementsFromProvider()
   - getContentFromProvider()
   - getFromProvider()
   ```

2. Create `src/formatUtils.ts`:
   ```typescript
   // Move from utils.ts
   - truncateString()
   - formatToolCallArgs()
   - formatToolCall()
   - formatToolCalls()
   - extractLastMessageContent()
   - wrapContent() // if not in prompt.ts
   ```

3. Create `src/processUtils.ts`:
   ```typescript
   // Move from utils.ts
   - spawnCommand()
   - execAsync()
   - ProgressIndicator class
   
   // From systemUtils.ts
   - waitForEscape()
   - stopWaitingForEscape()
   - setRawMode()
   ```

#### Testing:
- Test provider loading and execution
- Verify formatting functions
- Test process spawning and progress indicators

---

### Release 5: Final Cleanup
**Risk Level:** High  
**Breaking Changes:** Yes (removal of deprecated code)

#### Actions:
1. Remove all deprecated files:
   - Delete `globalConfigUtils.ts`
   - Delete `debugUtils.ts`
   - Clean up old exports from `utils.ts`

2. Create specialized utilities:
   ```typescript
   // src/versionUtils.ts
   - getSlothVersion()
   
   // src/hooksUtils.ts
   - executeHooks()
   ```

3. Final file structure:
   ```
   src/
   ├── fileUtils.ts        # All file I/O operations
   ├── pathUtils.ts        # All path management
   ├── consoleUtils.ts     # All logging/display
   ├── processUtils.ts     # Process/spawn operations
   ├── formatUtils.ts      # String/output formatting
   ├── versionUtils.ts     # Version management
   ├── hooksUtils.ts       # Hook execution
   ├── cliUtils.ts         # CLI parsing (unchanged)
   └── llmUtils.ts         # LLM config (unchanged)
   ```

4. Update all imports throughout codebase
5. Update documentation

#### Testing:
- Full regression test suite
- Integration tests for all commands
- Performance testing to ensure no degradation

---

## Migration Guide for Each Release

### For Release 1:
```typescript
// Old import
import { readFileFromProjectDir } from '#src/utils/utils.js';

// New import (both work in Release 1)
import { readFileFromProjectDir } from '#src/fileUtils.js';
```

### For Release 2:
```typescript
// Old import
import { getGlobalGslothDir } from '#src/utils/globalConfigUtils.js';

// New import
import { getGlobalGslothDir } from '#src/utils/fileUtils.js';
```

### For Release 3:
```typescript
// Old imports
import { debugLog } from '#src/utils/debugUtils.js';
import { displayError } from '#src/utils/consoleUtils.js';

// New unified import
import { debugLog, displayError } from '#src/utils/consoleUtils.js';
```

### For Release 4:
```typescript
// Old import
import { getContentFromProvider } from '#src/commands/commandUtils.js';

// New import
import { getContentFromProvider } from '#src/providers/providerUtils.js';
```

### For Release 5:
All deprecated imports must be updated. No backward compatibility.

---

## Success Metrics

### Per Release:
- All existing tests pass
- No runtime errors in production
- Import statements updated successfully
- Documentation updated

### Overall Goals:
- **Reduced file count**: From 9 to 9 more focused files
- **Clear boundaries**: Each file has a single responsibility
- **Better discoverability**: Obvious where to find functionality
- **Improved testability**: Easier to mock dependencies
- **Reduced coupling**: Minimal cross-dependencies

---

## Rollback Plan

Each release can be rolled back independently:

1. **Release 1-4**: Simply revert the commit, as backward compatibility is maintained
2. **Release 5**: Requires reverting and restoring deprecated files

---

## Timeline Recommendation

- **Release 1**: Week 1-2 (Low risk, good foundation)
- **Release 2**: Week 3-4 (Builds on Release 1)
- **Release 3**: Week 5-6 (More complex, needs careful testing)
- **Release 4**: Week 7-8 (Medium complexity)
- **Release 5**: Week 9-10 (High risk, requires full testing)

Allow 1-2 weeks between releases for stability monitoring.

---

## Alternative Approach (More Conservative)

If the 5-release plan is too aggressive, consider:

1. **Phase 1** (Releases 1-2): File I/O and Path consolidation only
2. **Phase 2** (Releases 3-4): Logging consolidation only  
3. **Phase 3** (Release 5): Final cleanup after 2-3 months

This allows more time to identify issues and gather feedback.