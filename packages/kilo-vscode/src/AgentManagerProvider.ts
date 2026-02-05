import * as vscode from 'vscode';

/**
 * AgentManagerProvider manages the Agent Manager webview panel.
 * Opens in the main editor area (not sidebar).
 */
export class AgentManagerProvider implements vscode.Disposable {
	public static readonly viewType = 'kilo-code.new.AgentManagerPanel';

	private panel: vscode.WebviewPanel | undefined;
	private panelDisposables: vscode.Disposable[] = [];

	constructor(private readonly _extensionUri: vscode.Uri) {}

	/**
	 * Open or focus the Agent Manager panel
	 */
	public openPanel(): void {
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.One);
			return;
		}

		this.panel = vscode.window.createWebviewPanel(
			AgentManagerProvider.viewType,
			'Agent Manager',
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [this._extensionUri]
			}
		);

		this.panel.webview.html = this._getHtmlForWebview(this.panel.webview);

		this.panel.onDidDispose(
			() => {
				// Clean up panel-specific disposables when panel is closed
				this.panelDisposables.forEach(d => d.dispose());
				this.panelDisposables = [];
				this.panel = undefined;
			},
			null,
			this.panelDisposables
		);

		console.log('Agent Manager panel opened');
	}

	private _getHtmlForWebview(webview: vscode.Webview): string {
		const nonce = getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<title>Agent Manager</title>
	<style>
		body {
			padding: 20px;
			color: var(--vscode-foreground);
			font-family: var(--vscode-font-family);
			display: flex;
			justify-content: center;
			align-items: center;
			min-height: 100vh;
			margin: 0;
		}
		h1 {
			font-size: 2em;
		}
	</style>
</head>
<body>
	<h1>Agent Manager</h1>
</body>
</html>`;
	}

	public dispose(): void {
		this.panel?.dispose();
		this.panelDisposables.forEach(d => d.dispose());
		this.panelDisposables = [];
	}
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
