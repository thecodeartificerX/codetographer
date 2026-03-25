import { existsSync, readFileSync } from 'fs';
import { atomicWrite } from '../dist/atomic-write.js';
/**
 * Update the ## Recent Activity section in INDEX.md with the last 5 changes.
 * Writes via atomicWrite only if content changed.
 */
export function updateRecentActivity(indexPath, changes) {
    if (!existsSync(indexPath) || changes.length === 0)
        return;
    try {
        let content = readFileSync(indexPath, 'utf-8');
        const section = '## Recent Activity';
        const sectionIdx = content.indexOf(section);
        const newSection = section + '\n\n' +
            changes.slice(-5).map(c => `- ${c}`).join('\n') + '\n';
        let updated;
        if (sectionIdx >= 0) {
            const nextSection = content.indexOf('\n## ', sectionIdx + 1);
            if (nextSection >= 0) {
                updated = content.slice(0, sectionIdx) + newSection + '\n' + content.slice(nextSection);
            }
            else {
                updated = content.slice(0, sectionIdx) + newSection;
            }
        }
        else {
            updated = content + '\n' + newSection;
        }
        if (updated !== content) {
            atomicWrite(indexPath, updated);
        }
    }
    catch { /* ignore */ }
}
