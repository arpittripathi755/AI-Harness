import * as vscode from "vscode";
import { SidebarProvider } from "./SidebarProvider";
import { promptAndStoreApiKey } from "./config";

export function activate(context: vscode.ExtensionContext) {
  console.log("Axiom Activated");

  const provider = new SidebarProvider(context);

  context.subscriptions.push( 
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewType,
      provider,
    ),
    vscode.commands.registerCommand("claude-agent.setApiKey", async () => { 
      const stored = await promptAndStoreApiKey(context);
      if (stored) {
        vscode.window.showInformationMessage("Axiom API key saved.");
      }
    }),
    vscode.commands.registerCommand("claude-agent.newChat", () => {
      provider.newChat();
    }),
    vscode.commands.registerCommand("claude-agent.open", () => {
      // Reveal the chat view (VS Code auto-generates the `<viewId>.focus` command).
      vscode.commands.executeCommand("claudeAgent.chat.focus");
    }),
    vscode.commands.registerCommand("claude-agent.apiSettings", () => {
      vscode.commands.executeCommand("claudeAgent.chat.focus");
      provider.openApiSettings();
    }),
  );
} 

export function deactivate() {}
