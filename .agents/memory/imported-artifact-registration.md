---
name: Imported artifact registration
description: Restore managed workflows when imported artifact files exist but the registry is empty.
---

For an imported pnpm artifact project, an empty artifact registry does not mean the existing apps need new scaffolds. Validate existing artifact metadata through the artifact replacement callback first.

**Why:** The GitHub import included valid artifact definitions, but neither artifacts nor their managed workflows appeared until an existing definition was revalidated. This also discovered sibling artifact definitions.

**How to apply:** If artifact directories and definitions already exist but listing artifacts returns none, read and copy a definition into a temporary file, then use `verifyAndReplaceArtifactToml`. Re-list artifacts and workflows afterward, and start the existing services rather than creating duplicate apps.
