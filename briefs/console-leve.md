I want console level output of src/utils/consoleUtils.ts to be controlled via config with default value at some reasonable level (not debug).
StatusLevel should be converted to enum, so we can check level by ordinal.
displayDebug should have jsdoc explaining that there's also a debug function in debugUtils.
debugUtils should also use console utils debug log to output log when it is at debug level.
 