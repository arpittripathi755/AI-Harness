import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('Axiom extension is present and can activate', async () => {
		const ext = vscode.extensions.getExtension('arpit.claude-agent');
		assert.ok(ext, 'Extension arpit.claude-agent should be found');
		await ext.activate();
		assert.strictEqual(ext.isActive, true);
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('claude-agent.open'), 'claude-agent.open should be registered');
	});

	test('claude-agent.open command executes successfully', async () => {
		await vscode.commands.executeCommand('claude-agent.open');
	});

	test('TaskMemory preserves context across multiple tool calls and reasoning cycles', async () => {
		const { TaskMemory } = await import('../agent/TaskMemory.js');
		const memory = new TaskMemory();

		// 1. Initial user request
		memory.recordUserRequest("Find the auth bug, fix it in auth.ts, add tests in auth.test.ts, and run tests.");

		// 2. Assistant plan
		memory.recordAssistantTurn(
			"I will execute this in steps:\n1. Search for auth files\n2. Inspect auth.ts\n3. Edit auth.ts to fix the issue\n4. Run tests and verify"
		);

		// 3. Tool: search_workspace
		memory.recordToolExecution(
			"search_workspace",
			{ query: "authenticateUser" },
			true,
			"Found 3 matches across 2 files",
			"src/auth.ts:15: authenticateUser\nsrc/routes.ts:32: authenticateUser"
		);

		// 4. Tool: read_file
		memory.recordToolExecution(
			"read_file",
			{ path: "src/auth.ts", start_line: 1, end_line: 45 },
			true,
			"Read src/auth.ts (lines 1-45)",
			"src/auth.ts (lines 1-45 of 90)\n1: export function authenticateUser..."
		);

		// 5. Tool: edit_file
		memory.recordToolExecution(
			"edit_file",
			{ path: "src/auth.ts", old_string: "return false;", new_string: "return true;" },
			true,
			"Edited src/auth.ts",
			"Edited src/auth.ts (1 replacement)."
		);

		// 6. Tool: create_file
		memory.recordToolExecution(
			"create_file",
			{ path: "src/auth.test.ts", content: "test('auth', () => {});" },
			true,
			"Created src/auth.test.ts",
			"Created src/auth.test.ts."
		);

		// 7. Tool: run_command (first attempt failed)
		memory.recordToolExecution(
			"run_command",
			{ command: "npm test" },
			false,
			"`npm test` exited 1",
			"$ npm test\nexit code: 1\n\nstderr:\n1 test failed: auth.test.ts"
		);

		// 8. Follow-up user request
		memory.recordUserRequest("Make sure to check the token expiry as well.");

		// Verify system prompt formatting contains all key elements
		const formatted = memory.formatForSystemPrompt();
		assert.ok(formatted.includes("Find the auth bug, fix it in auth.ts"), "Should contain original user request");
		assert.ok(formatted.includes("Make sure to check the token expiry"), "Should contain follow-up instruction");
		assert.ok(formatted.includes("src/auth.ts (lines 1-45)"), "Should contain files read");
		assert.ok(formatted.includes("Modified: src/auth.ts"), "Should contain modified file");
		assert.ok(formatted.includes("Created: src/auth.test.ts"), "Should contain created file");
		assert.ok(formatted.includes("Search \"authenticateUser\""), "Should contain exploration findings");
		assert.ok(formatted.includes("$ npm test"), "Should contain command results");
		assert.ok(formatted.includes("Command failed: `npm test`"), "Should contain error to fix");
		assert.ok(formatted.includes("1. Search for auth files"), "Should contain plan steps");

		// 9. Serialization and rehydration test (for persistence and reload)
		const serialized = memory.exportData();
		const reloaded = TaskMemory.fromData(serialized);
		const reloadedPrompt = reloaded.formatForSystemPrompt();
		assert.strictEqual(reloadedPrompt, formatted, "Reloaded memory should be identical to original");
	});

	test('Different conversations maintain completely separate, isolated task memories', async () => {
		const { TaskMemory } = await import('../agent/TaskMemory.js');

		const chat1Memory = new TaskMemory();
		chat1Memory.recordUserRequest("Refactor database connector in db.ts");
		chat1Memory.recordToolExecution("edit_file", { path: "src/db.ts" }, true, "Edited src/db.ts", "Edited src/db.ts");

		const chat2Memory = new TaskMemory();
		chat2Memory.recordUserRequest("Style the header bar in styles.css");
		chat2Memory.recordToolExecution("edit_file", { path: "src/styles.css" }, true, "Edited src/styles.css", "Edited src/styles.css");

		const chat1Prompt = chat1Memory.formatForSystemPrompt();
		const chat2Prompt = chat2Memory.formatForSystemPrompt();

		// Verify chat1 has db.ts and NOT styles.css
		assert.ok(chat1Prompt.includes("db.ts"), "Chat 1 should have db.ts");
		assert.ok(!chat1Prompt.includes("styles.css"), "Chat 1 must not contain Chat 2 files");

		// Verify chat2 has styles.css and NOT db.ts
		assert.ok(chat2Prompt.includes("styles.css"), "Chat 2 should have styles.css");
		assert.ok(!chat2Prompt.includes("db.ts"), "Chat 2 must not contain Chat 1 files");
	});

	test('Standalone vscodeShim filesystem operations work correctly without VS Code', async () => {
		const { workspace, Uri, FileType } = await import('../standalone/vscodeShim.js');
		const os = await import('os');
		const path = await import('path');

		const tempDir = path.join(os.tmpdir(), `daxiom-test-${Date.now()}`);
		const testFile = Uri.file(path.join(tempDir, 'test.txt'));
		const renamedFile = Uri.file(path.join(tempDir, 'renamed.txt'));

		// 1. Write file
		const content = new TextEncoder().encode("Hello autonomous Daxiom");
		await workspace.fs.writeFile(testFile, content);

		// 2. Stat file
		const stat = await workspace.fs.stat(testFile);
		assert.strictEqual(stat.type, FileType.File);
		assert.strictEqual(stat.size, content.length);

		// 3. Read file
		const readBytes = await workspace.fs.readFile(testFile);
		const readStr = new TextDecoder().decode(readBytes);
		assert.strictEqual(readStr, "Hello autonomous Daxiom");

		// 4. Rename file
		await workspace.fs.rename(testFile, renamedFile);
		const renamedStat = await workspace.fs.stat(renamedFile);
		assert.strictEqual(renamedStat.type, FileType.File);

		// 5. Delete file
		await workspace.fs.delete(renamedFile);
		let exists = true;
		try {
			await workspace.fs.stat(renamedFile);
		} catch {
			exists = false;
		}
		assert.strictEqual(exists, false, "Deleted file should no longer exist");

		// Clean up tempDir
		await workspace.fs.delete(Uri.file(tempDir), { recursive: true });
	});

	test('Autonomous tool execution runs file modifications and commands without manual approval', async () => {
		const { deleteFileTool } = await import('../tools/impl/deleteFile.js');
		const { runCommandTool } = await import('../tools/impl/runCommand.js');
		const { createFileTool } = await import('../tools/impl/createFile.js');
		const { editFileTool } = await import('../tools/impl/editFile.js');
		const { readFileTool } = await import('../tools/impl/readFile.js');
		const os = await import('os');
		const path = await import('path');
		const fs = await import('fs');

		const tempDir = path.join(os.tmpdir(), `daxiom-auto-${Date.now()}`);
		fs.mkdirSync(tempDir, { recursive: true });
		const workspaceUri = vscode.Uri.file(tempDir);

		let confirmCalled = false;
		const autonomousContext = {
			workspaceRoot: workspaceUri,
			terminalAutoRun: true,
			autoEdit: true,
			resolvePath: async (input: string) => {
				const resolved = path.isAbsolute(input) ? input : path.join(tempDir, input);
				return vscode.Uri.file(resolved);
			},
			toRelative: (uri: vscode.Uri) => path.relative(tempDir, uri.fsPath),
			confirm: async () => {
				confirmCalled = true;
				return true;
			},
		};

		// 1. Create file autonomously
		const createRes = await createFileTool.execute({ path: "app.ts", content: "console.log('original');" }, autonomousContext);
		assert.ok(createRes.summary?.includes("Created app.ts"));
		assert.strictEqual(confirmCalled, false, "Creating files should not ask confirmation");

		// 2. Read file autonomously
		const readRes = await readFileTool.execute({ path: "app.ts" }, autonomousContext);
		assert.ok(readRes.content.includes("console.log('original');"));

		// 3. Edit file autonomously
		const editRes = await editFileTool.execute({
			path: "app.ts",
			old_string: "original",
			new_string: "updated",
		}, autonomousContext);
		assert.ok(editRes.summary?.includes("Edited app.ts"));
		assert.strictEqual(confirmCalled, false, "Editing files should not ask confirmation");

		// 4. Run command autonomously
		const cmdRes = await runCommandTool.execute({ command: "node -e \"console.log('Autonomous execution works')\"" }, autonomousContext);
		assert.strictEqual(cmdRes.isError, false);
		assert.ok(cmdRes.content.includes("Autonomous execution works"));
		assert.strictEqual(confirmCalled, false, "Running commands in terminalAutoRun should not ask confirmation");

		// 5. Delete file autonomously (autoEdit: true must bypass confirm)
		const deleteRes = await deleteFileTool.execute({ path: "app.ts" }, autonomousContext);
		assert.ok(deleteRes.summary?.includes("Deleted app.ts"));
		assert.strictEqual(confirmCalled, false, "Deleting files in autoEdit mode should not ask confirmation");

		// Clean up
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	test('TUI utilities correctly format tool outputs, test passes, and test failures', async () => {
		const { stripAnsi, padBetween } = await import('../cli/tui.js');

		// stripAnsi removes color codes
		const colored = "\x1b[32m✓ 24 tests passed\x1b[0m";
		assert.strictEqual(stripAnsi(colored), "✓ 24 tests passed");

		// padBetween distributes space correctly
		const padded = padBetween("DAXIOM", "AUTO EDIT: ON", 30);
		assert.ok(padded.startsWith("DAXIOM"));
		assert.ok(padded.endsWith("AUTO EDIT: ON"));
		assert.strictEqual(padded.length, 30);
	});
});

