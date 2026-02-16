import { Component, Show, For, createSignal, createMemo, createEffect } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Select } from "@kilocode/kilo-ui/select"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useVSCode } from "../context/vscode"
import { useLanguage } from "../context/language"
import DeviceAuthCard from "./DeviceAuthCard"
import type { ProfileData, DeviceAuthState } from "../types/messages"

export type { ProfileData }

export interface ProfileViewProps {
  profileData: ProfileData | null | undefined
  deviceAuth: DeviceAuthState
  onLogin: () => void
  onDone?: () => void
}

const formatBalance = (amount: number): string => {
  return `$${amount.toFixed(2)}`
}

const PERSONAL = "personal"
const APP_BASE_URL = "https://app.kilo.ai"
const CREDIT_PACKAGES = [
  { credits: 20, popular: false },
  { credits: 50, popular: true },
  { credits: 100, popular: false },
  { credits: 200, popular: false },
]

interface OrgOption {
  value: string
  label: string
  description?: string
}

const getInitial = (value: string): string => {
  const trimmed = value.trim()
  if (!trimmed) {
    return "?"
  }
  return trimmed.charAt(0).toUpperCase()
}

const KiloBrandLogo: Component = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 50 50"
    width="74"
    height="74"
    aria-hidden="true"
    style={{ opacity: 0.9, "margin-bottom": "2px" }}
  >
    <path
      fill="var(--vscode-descriptionForeground)"
      d="M0,0v50h50V0H0ZM46.2962963,46.2962963H3.7037037V3.7037037h42.5925926v42.5925926ZM30.5555522,35.9548042h4.6296296v3.7037037h-5.8201058l-2.5132275-2.5132275v-5.8201058h3.7037037v4.6296296ZM38.8888855,35.9548042h-3.7037037v-4.6296296h-4.6296296v-3.7037037h5.8201058l2.5132275,2.5132275v5.8201058ZM23.1481481,30.5557103h-3.7037037v-3.7037037h3.7037037v3.7037037ZM11.1111111,26.8520066h3.7037037v8.3333333h8.3333333v3.7037037h-9.5238095l-2.5132275-2.5132275v-9.5238095ZM38.8888855,19.4444444v3.7037037h-12.037037v-3.7037037h4.1390959v-4.6296296h-4.1390959v-3.7037037h5.3295721l2.5132275,2.5132275v5.8201058h4.1942374ZM14.8148148,15.2777778h4.6296296l3.7037037,3.7037037v4.1666667h-3.7037037v-4.1666667h-4.6296296v4.1666667h-3.7037037v-12.037037h3.7037037v4.1666667ZM23.1481481,15.2777778h-3.7037037v-4.1666667h3.7037037v4.1666667Z"
    />
  </svg>
)

const ProfileView: Component<ProfileViewProps> = (props) => {
  const vscode = useVSCode()
  const language = useLanguage()
  const [target, setTarget] = createSignal<string | null>(null)

  createEffect(() => {
    props.profileData
    setTarget(null)
  })

  const switching = createMemo(() => {
    const nextTarget = target()
    if (nextTarget === null) return false
    const current = props.profileData?.currentOrgId ?? PERSONAL
    return current !== nextTarget
  })

  const orgOptions = createMemo<OrgOption[]>(() => {
    const orgs = props.profileData?.profile.organizations ?? []
    if (orgs.length === 0) return []
    return [
      { value: PERSONAL, label: language.t("profile.account.personal") },
      ...orgs.map((org) => ({ value: org.id, label: org.name, description: org.role })),
    ]
  })

  const currentOrg = createMemo(() => {
    const id = props.profileData?.currentOrgId ?? PERSONAL
    return orgOptions().find((option) => option.value === id)
  })

  const selectOrg = (option: OrgOption | undefined) => {
    if (!option) return
    const current = props.profileData?.currentOrgId ?? PERSONAL
    if (option.value === current) return
    setTarget(option.value)
    vscode.postMessage({
      type: "setOrganization",
      organizationId: option.value === PERSONAL ? null : option.value,
    })
  }

  const handleLogin = () => {
    props.onLogin()
  }

  const handleLogout = () => {
    vscode.postMessage({ type: "logout" })
  }

  const handleRefresh = () => {
    vscode.postMessage({ type: "refreshProfile" })
  }

  const handleDashboard = () => {
    vscode.postMessage({ type: "openExternal", url: `${APP_BASE_URL}/profile` })
  }

  const handleUsageDetails = () => {
    const orgId = props.profileData?.currentOrgId
    if (!orgId) {
      return
    }
    vscode.postMessage({
      type: "openExternal",
      url: `${APP_BASE_URL}/organizations/${orgId}/usage-details`,
    })
  }

  const handleCreateOrganization = () => {
    vscode.postMessage({ type: "openExternal", url: `${APP_BASE_URL}/organizations/new` })
  }

  const handleBuyCredits = (credits: number) => {
    vscode.postMessage({
      type: "openExternal",
      url: `${APP_BASE_URL}/profile?buyCredits=${credits}`,
    })
  }

  const handleCancelLogin = () => {
    vscode.postMessage({ type: "cancelLogin" })
  }

  return (
    <div style={{ padding: "16px" }}>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          "margin-bottom": "12px",
        }}
      >
        <h2
          style={{
            "font-size": "16px",
            "font-weight": "600",
            margin: 0,
            color: "var(--vscode-foreground)",
          }}
        >
          {language.t("profile.title")}
        </h2>
        <div style={{ flex: 1 }} />
        <Show when={props.onDone}>
          <Button size="small" variant="secondary" onClick={() => props.onDone?.()}>
            {language.t("common.done")}
          </Button>
        </Show>
      </div>

      <Show
        when={props.profileData}
        fallback={
          <div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
            <Show
              when={props.deviceAuth.status !== "idle"}
              fallback={
                <div
                  style={{
                    display: "flex",
                    "flex-direction": "column",
                    "align-items": "center",
                    gap: "10px",
                    "text-align": "center",
                    padding: "10px 4px 8px",
                  }}
                >
                  <KiloBrandLogo />
                  <h3
                    style={{
                      margin: 0,
                      "font-size": "20px",
                      "font-weight": "700",
                      color: "var(--vscode-foreground)",
                    }}
                  >
                    {language.t("profile.welcome.greeting")}
                  </h3>
                  <p
                    style={{
                      margin: 0,
                      "font-size": "13px",
                      color: "var(--vscode-descriptionForeground)",
                    }}
                  >
                    {language.t("profile.welcome.introText1")}
                  </p>
                  <p
                    style={{
                      margin: 0,
                      "font-size": "13px",
                      color: "var(--vscode-descriptionForeground)",
                    }}
                  >
                    {language.t("profile.welcome.introText2")}
                  </p>
                  <p
                    style={{
                      margin: 0,
                      "font-size": "13px",
                      color: "var(--vscode-descriptionForeground)",
                    }}
                  >
                    {language.t("profile.welcome.introText3")}
                  </p>
                  <Button
                    variant="primary"
                    size="large"
                    onClick={handleLogin}
                    style={{ "margin-top": "12px", width: "100%", "min-height": "46px" }}
                  >
                    {language.t("profile.welcome.ctaButton")}
                  </Button>
                </div>
              }
            >
              <DeviceAuthCard
                status={props.deviceAuth.status}
                code={props.deviceAuth.code}
                verificationUrl={props.deviceAuth.verificationUrl}
                expiresIn={props.deviceAuth.expiresIn}
                error={props.deviceAuth.error}
                onCancel={handleCancelLogin}
                onRetry={handleLogin}
              />
            </Show>
          </div>
        }
      >
        {(data) => (
          <div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
            <Card
              style={{
                display: "flex",
                "align-items": "center",
                gap: "12px",
              }}
            >
              <Show
                when={
                  (data().profile as { image?: string; avatarUrl?: string }).image ||
                  (data().profile as { image?: string; avatarUrl?: string }).avatarUrl
                }
                fallback={
                  <div
                    style={{
                      width: "56px",
                      height: "56px",
                      "border-radius": "999px",
                      background: "var(--vscode-button-background)",
                      color: "var(--vscode-button-foreground)",
                      display: "flex",
                      "align-items": "center",
                      "justify-content": "center",
                      "font-size": "24px",
                      "font-weight": "600",
                      "flex-shrink": "0",
                    }}
                  >
                    {getInitial(data().profile.name || data().profile.email)}
                  </div>
                }
              >
                {(avatar) => (
                  <img
                    src={avatar()}
                    alt="Profile"
                    style={{
                      width: "56px",
                      height: "56px",
                      "border-radius": "999px",
                      "object-fit": "cover",
                      "flex-shrink": "0",
                    }}
                  />
                )}
              </Show>
              <div style={{ "min-width": "0" }}>
                <p
                  style={{
                    "font-size": "15px",
                    "font-weight": "600",
                    color: "var(--vscode-foreground)",
                    margin: "0 0 4px 0",
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                  }}
                >
                  {data().profile.name || data().profile.email}
                </p>
                <p
                  style={{
                    "font-size": "12px",
                    color: "var(--vscode-descriptionForeground)",
                    margin: 0,
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                  }}
                >
                  {data().profile.email}
                </p>
              </div>
            </Card>

            <Show when={orgOptions().length > 0}>
              <Card>
                <p
                  style={{
                    "font-size": "11px",
                    "text-transform": "uppercase",
                    "letter-spacing": "0.5px",
                    color: "var(--vscode-descriptionForeground)",
                    margin: "0 0 8px 0",
                  }}
                >
                  {language.t("profile.account.label")}
                </p>
                <Select
                  options={orgOptions()}
                  current={currentOrg()}
                  value={(option) => option.value}
                  label={(option) => option.label}
                  onSelect={selectOrg}
                  variant="secondary"
                  size="small"
                  triggerVariant="settings"
                  disabled={switching()}
                />
              </Card>
            </Show>

            <div style={{ display: "grid", "grid-template-columns": "repeat(auto-fit, minmax(140px, 1fr))", gap: "8px" }}>
              <Button variant="secondary" onClick={handleDashboard} style={{ flex: "1" }}>
                {language.t("profile.action.dashboard")}
              </Button>
              <Button variant="secondary" onClick={handleLogout} style={{ flex: "1" }}>
                {language.t("profile.action.logout")}
              </Button>
            </div>

            <Show when={data().currentOrgId}>
              <Button variant="secondary" onClick={handleUsageDetails} style={{ width: "100%" }}>
                {language.t("profile.action.usageDetails")}
              </Button>
            </Show>
            <Show when={!data().currentOrgId && (data().profile.organizations?.length ?? 0) === 0}>
              <Button variant="primary" onClick={handleCreateOrganization} style={{ width: "100%" }}>
                {language.t("profile.action.createOrganization")}
              </Button>
            </Show>

            <div
              style={{
                height: "1px",
                background: "var(--vscode-panel-border)",
                margin: "2px 0",
              }}
            />

            <Show when={data().balance}>
              {(balance) => (
                <Card
                  style={{
                    display: "grid",
                    gap: "8px",
                    "justify-items": "center",
                    padding: "16px 12px",
                  }}
                >
                  <p
                    style={{
                      "font-size": "11px",
                      "text-transform": "uppercase",
                      "letter-spacing": "0.5px",
                      color: "var(--vscode-descriptionForeground)",
                      margin: 0,
                    }}
                  >
                    {language.t("profile.balance.title")}
                  </p>
                  <p
                    style={{
                      "font-size": "34px",
                      "font-weight": "700",
                      color: "var(--vscode-foreground)",
                      margin: 0,
                      "font-variant-numeric": "tabular-nums",
                      "line-height": "1",
                    }}
                  >
                    {formatBalance(balance().balance)}
                  </p>
                  <Tooltip value={language.t("profile.balance.refresh")} placement="left">
                    <Button variant="ghost" size="small" onClick={handleRefresh} aria-label={language.t("common.refresh")}>
                      ↻
                    </Button>
                  </Tooltip>
                </Card>
              )}
            </Show>

            <Show when={!data().currentOrgId}>
              <Card>
                <div
                  style={{
                    "font-size": "14px",
                    "font-weight": "600",
                    "margin-bottom": "10px",
                    color: "var(--vscode-foreground)",
                  }}
                >
                  {language.t("profile.shop.title")}
                </div>
                <div
                  style={{
                    display: "grid",
                    "grid-template-columns": "repeat(auto-fit, minmax(120px, 1fr))",
                    gap: "8px",
                  }}
                >
                  <For each={CREDIT_PACKAGES}>
                    {(pkg) => (
                      <div
                        style={{
                          position: "relative",
                          border: `1px solid ${
                            pkg.popular ? "var(--vscode-button-background)" : "var(--vscode-input-border)"
                          }`,
                          "border-radius": "8px",
                          padding: "8px",
                          background: "var(--vscode-editor-background)",
                        }}
                      >
                        <Show when={pkg.popular}>
                          <div
                            style={{
                              position: "absolute",
                              top: "-8px",
                              left: "50%",
                              transform: "translateX(-50%)",
                              background: "var(--vscode-button-background)",
                              color: "var(--vscode-button-foreground)",
                              "font-size": "10px",
                              "font-weight": "600",
                              padding: "2px 6px",
                              "border-radius": "999px",
                              "text-transform": "uppercase",
                              "letter-spacing": "0.4px",
                          }}
                        >
                            {language.t("profile.shop.popular")}
                          </div>
                        </Show>
                        <div
                          style={{
                            "font-size": "20px",
                            "font-weight": "700",
                            color: "var(--vscode-foreground)",
                            "text-align": "center",
                            "margin-top": pkg.popular ? "6px" : "0",
                            "font-variant-numeric": "tabular-nums",
                          }}
                        >
                          ${pkg.credits}
                        </div>
                        <div
                          style={{
                            "font-size": "11px",
                            color: "var(--vscode-descriptionForeground)",
                            "text-align": "center",
                            "margin-bottom": "8px",
                          }}
                        >
                          {language.t("profile.shop.credits")}
                        </div>
                        <Button
                          variant={pkg.popular ? "primary" : "secondary"}
                          size="small"
                          style={{ width: "100%" }}
                          onClick={() => handleBuyCredits(pkg.credits)}
                        >
                          {language.t("profile.shop.action")}
                        </Button>
                      </div>
                    )}
                  </For>
                </div>
                <div style={{ display: "flex", "justify-content": "center", "margin-top": "10px" }}>
                  <Button variant="ghost" size="small" onClick={handleDashboard}>
                    {language.t("profile.shop.viewAll")}
                  </Button>
                </div>
              </Card>
            </Show>
          </div>
        )}
      </Show>
    </div>
  )
}

export default ProfileView
