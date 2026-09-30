import { defineConfig } from '@vscode/test-cli';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Searches the local .vscode-test directory on macOS for existing VS Code installations
 * where the binary is named 'Code'.
 */
function findDownloadedMacOSExecutable() {
	if (process.platform !== 'darwin') {
		return undefined;
	}
	const cacheDir = path.resolve('.vscode-test');
	if (!fs.existsSync(cacheDir)) {
		return undefined;
	}
	try {
		const entries = fs.readdirSync(cacheDir);
		for (const entry of entries) {
			if (entry.startsWith('vscode-darwin-')) {
				const macosDir = path.join(cacheDir, entry, 'Visual Studio Code.app/Contents/MacOS');
				const codeBin = path.join(macosDir, 'Code');
				if (fs.existsSync(codeBin)) {
					return codeBin;
				}
			}
		}
	} catch {
		// Ignore read error and fall through
	}
	return undefined;
}

const executablePath = findDownloadedMacOSExecutable();

export default defineConfig({
	files: 'out/test/**/*.test.js',
	...(executablePath ? { useInstallation: { fromPath: executablePath } } : {}),
});
