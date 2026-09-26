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
});
