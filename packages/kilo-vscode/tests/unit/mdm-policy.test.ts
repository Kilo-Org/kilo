import { describe, expect, it } from "bun:test"
import { evaluateMdmCompliance, type MdmPolicyConfig } from "../../src/services/mdm/mdm-policy"

function policy(overrides?: Partial<MdmPolicyConfig>): MdmPolicyConfig {
  return {
    requireCloudAuth: true,
    organizationId: "org-test",
    sourcePath: "/tmp/mdm.json",
    ...overrides,
  }
}

describe("evaluateMdmCompliance", () => {
  it("is compliant when no MDM policy is loaded", () => {
    const result = evaluateMdmCompliance(null, null)
    expect(result).toEqual({ compliant: true })
  })

  it("is compliant when policy does not require cloud auth", () => {
    const result = evaluateMdmCompliance(policy({ requireCloudAuth: false }), null)
    expect(result).toEqual({ compliant: true })
  })

  it("requires sign-in when cloud auth policy is active and no profile exists", () => {
    const result = evaluateMdmCompliance(policy(), null)
    expect(result.compliant).toBe(false)
    if (!result.compliant) {
      expect(result.reason).toContain("requires Kilo Code Cloud authentication")
    }
  })

  it("rejects organization mismatch", () => {
    const result = evaluateMdmCompliance(policy({ organizationId: "org-required" }), {
      profile: { email: "test@example.com", organizations: [{ id: "org-other", name: "Other", role: "member" }] },
      balance: null,
      currentOrgId: "org-other",
    })
    expect(result.compliant).toBe(false)
    if (!result.compliant) {
      expect(result.reason).toContain("org-required")
    }
  })

  it("accepts matching organization", () => {
    const result = evaluateMdmCompliance(policy({ organizationId: "org-required" }), {
      profile: { email: "test@example.com", organizations: [{ id: "org-required", name: "Required", role: "member" }] },
      balance: null,
      currentOrgId: "org-required",
    })
    expect(result).toEqual({ compliant: true })
  })
})
