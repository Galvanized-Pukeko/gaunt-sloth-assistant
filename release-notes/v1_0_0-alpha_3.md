# v1.0.0-alpha.3 Config Merge Fix

## Bug Fixes
- Fixed configuration merging for `pr` and `review` commands. Previously, when users defined partial command configs (e.g., setting `jira` as content provider), all default values including the `rating` config would be lost. The fix implements deep merging with a configurable `maxDepth` parameter (default: 4) to properly preserve nested defaults while respecting user overrides.
