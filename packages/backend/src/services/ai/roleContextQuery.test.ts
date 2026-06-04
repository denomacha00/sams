import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UserRole } from '@sams/shared';
import { queryRoleContext } from './roleContextQuery';
import { findAction } from './roleActionRegistry';

vi.mock('./roleActionRegistry', () => ({
  findAction: vi.fn(),
}));

const hodUser = {
  sub: 'hod-greenwood',
  schoolId: 'school-greenwood',
  role: UserRole.HOD,
  departmentId: 'dept-science',
  iat: 0,
  exp: 9999999999,
};

describe('roleContextQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes HOD school admin query to HOD registry handler', async () => {
    const handler = vi.fn().mockResolvedValue({
      answer: '🏫 **School administrator**\n\n• **Greenwood Admin** (admin@greenwood.edu)',
      data: { admins: [{ fullName: 'Greenwood Admin' }] },
    });
    vi.mocked(findAction).mockImplementation((role, action) => {
      if (role === UserRole.HOD && action === 'list_school_admin') {
        return {
          action: 'list_school_admin',
          handler,
          patterns: [],
          description: '',
          destructive: false,
          extractParams: () => ({}),
          descriptionTemplate: () => '',
        };
      }
      return undefined;
    });

    const result = await queryRoleContext(hodUser as never, 'who is adim of this school');
    expect(result?.intent).toBe('list_school_admin');
    expect(findAction).toHaveBeenCalledWith(UserRole.HOD, 'list_school_admin');
    expect(handler).toHaveBeenCalled();
    expect(result?.answer).toMatch(/Greenwood Admin/);
  });

  it('returns null for HOD on student-only actions', async () => {
    const result = await queryRoleContext(hodUser as never, 'my teachers');
    expect(result).toBeNull();
  });
});
