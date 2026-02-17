import { Component, Show, For, createSignal, createMemo, createEffect, onMount } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
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
  onDone: () => void
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
    width="100"
    height="100"
    aria-hidden="true"
    style={{ "margin-top": "16px", "margin-bottom": "16px" }}
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

  // Always fetch fresh profile+balance when navigating to this view
  onMount(() => {
    vscode.postMessage({ type: "refreshProfile" })
  })

  // Reset pending target whenever profileData changes (success or failure both send a fresh profile)
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
    // TODO(telemetry): capture CREATE_ORGANIZATION_LINK_CLICKED analytics event when telemetry pipeline is implemented.
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
    <div style={{ padding: "16px 12px 16px 16px" }}>
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
        <Button variant="secondary" onClick={props.onDone}>
          {language.t("common.done")}
        </Button>
      </div>

      <Show
        when={props.profileData}
        fallback={
          <div style={{ display: "flex", "flex-direction": "column" }}>
            <Show
              when={props.deviceAuth.status !== "idle"}
              fallback={
                <div
                  style={{
                    display: "flex",
                    "flex-direction": "column",
                    "align-items": "center",
                    "text-align": "center",
                  }}
                >
                  <KiloBrandLogo />
                  <h2
                    style={{
                      margin: "0 0 16px 0",
                      padding: 0,
                      "font-size": "calc(var(--vscode-font-size, 13px) * 1.5)",
                      "font-weight": "700",
                      "line-height": "1.2",
                      color: "var(--vscode-foreground)",
                    }}
                  >
                    {language.t("profile.welcome.greeting")}
                  </h2>
                  <p
                    style={{
                      margin: "0 0 10px 0",
                      "text-align": "center",
                    }}
                  >
                    {language.t("profile.welcome.introText1")}
                  </p>
                  <p
                    style={{
                      margin: "0 0 10px 0",
                      "text-align": "center",
                    }}
                  >
                    {language.t("profile.welcome.introText2")}
                  </p>
                  <p
                    style={{
                      margin: "0 0 20px 0",
                      "text-align": "center",
                    }}
                  >
                    {language.t("profile.welcome.introText3")}
                  </p>
                  <div style={{ width: "100%", display: "flex", "flex-direction": "column", gap: "20px" }}>
                    <Button
                      variant="primary"
                      onClick={handleLogin}
                      style={{
                        width: "100%",
                        height: "auto",
                        "min-height": "40px",
                        "font-size": "12px",
                        "font-weight": "600",
                        "line-height": "1.2",
                        padding: "14px",
                      }}
                    >
                      {language.t("profile.welcome.ctaButton")}
                    </Button>
                  </div>
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
          <div style={{ display: "flex", "flex-direction": "column" }}>
            <div
              style={{
                display: "flex",
                "align-items": "center",
                "flex-wrap": "wrap",
                "row-gap": "16px",
                gap: "16px",
                "margin-bottom": "24px",
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
                      width: "64px",
                      height: "64px",
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
                      width: "64px",
                      height: "64px",
                      "border-radius": "999px",
                      "object-fit": "cover",
                      "flex-shrink": "0",
                    }}
                  />
                )}
              </Show>
              <div style={{ "min-width": "0", flex: 1 }}>
                <p
                  style={{
                    "font-size": "18px",
                    "font-weight": "500",
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
                    "font-size": "14px",
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
            </div>

            <Show when={orgOptions().length > 0}>
              <div style={{ "margin-bottom": "24px" }}>
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
              </div>
            </Show>

            <div
              style={{
                display: "grid",
                "grid-template-columns": "repeat(auto-fit, minmax(225px, 1fr))",
                gap: "8px",
              }}
            >
              <Button variant="primary" onClick={handleDashboard} style={{ width: "100%" }}>
                {language.t("profile.action.dashboard")}
              </Button>
              <Button variant="secondary" onClick={handleLogout} style={{ width: "100%" }}>
                {language.t("profile.action.logout")}
              </Button>
            </div>

            <div style={{ "margin-top": "8px" }}>
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
            </div>

            <div
              style={{
                height: "1px",
                background: "var(--vscode-panel-border)",
                margin: "24px 0",
              }}
            />

            <Show when={data().balance}>
              {(balance) => (
                <div
                  style={{
                    width: "100%",
                    display: "flex",
                    "flex-direction": "column",
                    "align-items": "center",
                  }}
                >
                  <div
                    style={{
                      "font-size": "14px",
                      color: "var(--vscode-descriptionForeground)",
                      "margin-bottom": "12px",
                    }}
                  >
                    {language.t("profile.balance.title")}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      "align-items": "center",
                      gap: "8px",
                      "margin-bottom": "24px",
                    }}
                  >
                    <div
                      style={{
                        "font-size": "36px",
                        "font-weight": "700",
                        color: "var(--vscode-foreground)",
                        "font-variant-numeric": "tabular-nums",
                        "line-height": "1",
                      }}
                    >
                      {formatBalance(balance().balance)}
                    </div>
                    <Tooltip value={language.t("profile.balance.refresh")} placement="left">
                      <Button
                        variant="ghost"
                        size="small"
                        onClick={handleRefresh}
                        aria-label={language.t("common.refresh")}
                        style={{ "min-width": "32px", "margin-top": "2px" }}
                      >
                        <span class="codicon codicon-refresh" />
                      </Button>
                    </Tooltip>
                  </div>
                </div>
              )}
            </Show>

            <Show when={!data().currentOrgId}>
              <div style={{ width: "100%", "margin-top": "32px" }}>
                <div
                  style={{
                    "font-size": "18px",
                    "font-weight": "600",
                    "margin-bottom": "16px",
                    color: "var(--vscode-foreground)",
                    "text-align": "center",
                  }}
                >
                  {language.t("profile.shop.title")}
                </div>
                <div
                  style={{
                    display: "grid",
                    "grid-template-columns": "repeat(auto-fit, minmax(140px, 1fr))",
                    gap: "12px",
                    "margin-bottom": "24px",
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
                          "box-shadow": pkg.popular ? "0 0 0 1px var(--vscode-button-background)" : "none",
                          "border-radius": "8px",
                          padding: "16px",
                          background: "var(--vscode-editor-background)",
                          transition: "box-shadow 120ms ease",
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
                              "font-size": "12px",
                              "font-weight": "600",
                              padding: "2px 8px",
                              "border-radius": "999px",
                              "text-transform": "uppercase",
                              "letter-spacing": "0.4px",
                            }}
                          >
                            {language.t("profile.shop.popular")}
                          </div>
                        </Show>
                        <div style={{ "text-align": "center" }}>
                          <div
                            style={{
                              "font-size": "24px",
                              "font-weight": "700",
                              color: "var(--vscode-foreground)",
                              "margin-top": pkg.popular ? "6px" : "0",
                              "margin-bottom": "4px",
                              "font-variant-numeric": "tabular-nums",
                            }}
                          >
                            ${pkg.credits}
                          </div>
                          <div
                            style={{
                              "font-size": "14px",
                              color: "var(--vscode-descriptionForeground)",
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
                      </div>
                    )}
                  </For>
                </div>
                <div style={{ display: "flex", "justify-content": "center" }}>
                  <Button variant="secondary" size="small" onClick={handleDashboard}>
                    {language.t("profile.shop.viewAll")}
                  </Button>
                </div>
              </div>
            </Show>
          </div>
        )}
      </Show>
    </div>
  )
}

export default ProfileView
