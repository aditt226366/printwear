import { AppUserStatus, CompanyStatus } from "@prisma/client";
import { prisma } from "../config/prisma.js";

const PRINTWEAR_USERNAME = "Printwear@xyz";

export const printwearTenantService = {
  username: PRINTWEAR_USERNAME,

  async getPrintwearTenantId() {
    const user = await prisma.appUser.findFirst({
      where: {
        username: { equals: PRINTWEAR_USERNAME, mode: "insensitive" },
        role: "USER",
        status: AppUserStatus.ACTIVE
      },
      select: {
        companyId: true,
        company: { select: { id: true, status: true } }
      }
    });

    if (!user?.companyId || user.company?.status !== CompanyStatus.ACTIVE) {
      return null;
    }

    return user.companyId;
  },

  async isPrintwearTenant(tenantId?: string | null) {
    if (!tenantId) return false;
    const printwearTenantId = await this.getPrintwearTenantId();
    return Boolean(printwearTenantId && printwearTenantId === tenantId);
  }
};
