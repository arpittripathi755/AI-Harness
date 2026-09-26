import { defineConfig } from '@vscode/test-cli';
import * as fs from 'fs';
import * as path from 'path';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

/**
 * Searches the local .vscode-test directory on macOS for modern VS Code installations
 * where the binary is named 'Code' instead of 'Electron'.
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
				const electronBin = path.join(macosDir, 'Electron');
				const codeBin = path.join(macosDir, 'Code');
				if (!fs.existsSync(electronBin) && fs.existsSync(codeBin)) {
					return codeBin;
				}
			}
		}
	} catch {
		// Ignore read error and fall through
	}
	return undefined;
}

let executablePath = findDownloadedMacOSExecutable();
if (!executablePath && process.platform === 'darwin') {
	try {
		const downloaded = await downloadAndUnzipVSCode();
		if (downloaded && !fs.existsSync(downloaded)) {
			const codeCandidate = downloaded.replace(/Electron$/, 'Code');
			if (fs.existsSync(codeCandidate)) {
				executablePath = codeCandidate;
			}
		}
	} catch {
		// Fall back to default behavior if download helper fails
	}
}

export default defineConfig({
	files: 'out/test/**/*.test.js',
	...(executablePath ? { useInstallation: { fromPath: executablePath } } : {}),
});
