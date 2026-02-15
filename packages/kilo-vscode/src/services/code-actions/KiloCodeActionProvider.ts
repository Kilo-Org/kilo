import * as vscode from "vscode"

export const KILO_CODE_ACTION_COMMANDS = {
  explain: "kilo-code.new.codeAction.explainSelection",
  fix: "kilo-code.new.codeAction.fixSelection",
  improve: "kilo-code.new.codeAction.improveSelection",
} as const

export class KiloCodeActionProvider implements vscode.CodeActionProvider {
  public readonly providedCodeActionKinds = {
    quickfix: vscode.CodeActionKind.QuickFix,
    refactor: vscode.CodeActionKind.RefactorRewrite,
  }

  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
    const actions: vscode.CodeAction[] = []

    const diagnostic = context.diagnostics[0]
    if (diagnostic) {
      const args: [vscode.Uri, vscode.Range, string] = [document.uri, diagnostic.range, diagnostic.message]
      const diagnosticAction = new vscode.CodeAction("Kilo: Fix This Diagnostic", this.providedCodeActionKinds.quickfix)
      diagnosticAction.command = {
        command: KILO_CODE_ACTION_COMMANDS.fix,
        title: "Fix This Diagnostic",
        arguments: args,
      }
      diagnosticAction.diagnostics = [diagnostic]
      diagnosticAction.isPreferred = true
      actions.push(diagnosticAction)
    }

    if (range.isEmpty) {
      return actions
    }

    const args: [vscode.Uri, vscode.Range] = [document.uri, range]

    const explainAction = new vscode.CodeAction("Kilo: Explain Selection", this.providedCodeActionKinds.refactor)
    explainAction.command = {
      command: KILO_CODE_ACTION_COMMANDS.explain,
      title: "Explain Selection",
      arguments: args,
    }

    const fixAction = new vscode.CodeAction("Kilo: Fix Selection", this.providedCodeActionKinds.quickfix)
    fixAction.command = {
      command: KILO_CODE_ACTION_COMMANDS.fix,
      title: "Fix Selection",
      arguments: args,
    }

    const improveAction = new vscode.CodeAction("Kilo: Improve Selection", this.providedCodeActionKinds.refactor)
    improveAction.command = {
      command: KILO_CODE_ACTION_COMMANDS.improve,
      title: "Improve Selection",
      arguments: args,
    }

    actions.push(explainAction, fixAction, improveAction)
    return actions
  }
}
