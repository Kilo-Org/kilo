import { Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { useLanguage } from "../context/language"

interface ErrorPanelProps {
  message?: string
  onRetry: () => void
}

const ErrorPanel: Component<ErrorPanelProps> = (props) => {
  const language = useLanguage()

  return (
    <div class="connection-state-panel connection-state-panel-error">
      <h3 class="connection-state-title">{language.t("connection.error.title")}</h3>
      <p class="connection-state-message">{props.message || language.t("connection.error.defaultMessage")}</p>
      <Button variant="primary" size="small" onClick={props.onRetry}>
        {language.t("common.retry")}
      </Button>
    </div>
  )
}

export default ErrorPanel
