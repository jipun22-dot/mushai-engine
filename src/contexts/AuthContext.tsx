import * as React from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import {
  listPendingInvitationsForEmail,
  listUserMemberships,
  setActiveOrganisationForUser,
  syncUserProfile,
} from '../services/authService';
import {
  evaluateOrganisationAlerts,
  getOrganisation,
  getOrgMember,
  listDepartments,
  listOrgMembers,
  listSites,
  type ActorContext,
} from '../services/firestoreService';
import type {
  Department,
  Invitation,
  Organisation,
  OrgMember,
  Site,
  UserMembership,
  UserProfile,
} from '../types/domain';

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  authReady: boolean;
  loadingContext: boolean;
  memberships: UserMembership[];
  pendingInvitations: Invitation[];
  activeOrg: Organisation | null;
  activeMember: OrgMember | null;
  sites: Site[];
  departments: Department[];
  members: OrgMember[];
  selectedSiteId: string;
  setSelectedSiteId: (siteId: string) => void;
  selectedDepartmentId: string;
  setSelectedDepartmentId: (deptId: string) => void;
  switchOrganisation: (orgId: string) => Promise<void>;
  refreshContext: () => Promise<void>;
  actor: ActorContext | null;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [profile, setProfile] = React.useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = React.useState(false);
  const [loadingContext, setLoadingContext] = React.useState(false);

  const [memberships, setMemberships] = React.useState<UserMembership[]>([]);
  const [pendingInvitations, setPendingInvitations] = React.useState<Invitation[]>([]);
  const [activeOrg, setActiveOrg] = React.useState<Organisation | null>(null);
  const [activeMember, setActiveMember] = React.useState<OrgMember | null>(null);
  const [sites, setSites] = React.useState<Site[]>([]);
  const [departments, setDepartments] = React.useState<Department[]>([]);
  const [members, setMembers] = React.useState<OrgMember[]>([]);
  const [selectedSiteId, setSelectedSiteId] = React.useState<string>('ALL');
  const [selectedDepartmentId, setSelectedDepartmentId] = React.useState<string>('ALL');
  const evaluatedOrgRef = React.useRef<string | null>(null);

  const loadOrganisationDetails = React.useCallback(
    async (currentUser: User, orgId: string) => {
      const [org, member, orgSites, orgDepts, orgMembers] = await Promise.all([
        getOrganisation(orgId),
        getOrgMember(orgId, currentUser.uid),
        listSites(orgId),
        listDepartments(orgId),
        listOrgMembers(orgId),
      ]);

      setActiveOrg(org);
      setActiveMember(member);
      setSites(orgSites);
      setDepartments(orgDepts);
      setMembers(orgMembers);

      if (member && member.role !== 'org_admin' && member.role !== 'super_admin') {
        if (member.siteIds.length === 1) {
          setSelectedSiteId(member.siteIds[0]);
        } else {
          setSelectedSiteId('ALL');
        }
      } else {
        setSelectedSiteId('ALL');
      }
      setSelectedDepartmentId('ALL');

      if (org && member && member.status === 'active' && evaluatedOrgRef.current !== org.id) {
        evaluatedOrgRef.current = org.id;
        void evaluateOrganisationAlerts(org, {
          uid: currentUser.uid,
          displayName: member.displayName,
          email: member.email,
          role: member.role,
        });
      }
    },
    []
  );

  const refreshContext = React.useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setProfile(null);
      setMemberships([]);
      setPendingInvitations([]);
      setActiveOrg(null);
      setActiveMember(null);
      setSites([]);
      setDepartments([]);
      setMembers([]);
      return;
    }

    setLoadingContext(true);
    try {
      await syncUserProfile(currentUser);
      const userSnap = await getDoc(doc(db, 'users', currentUser.uid));
      const userProf = userSnap.exists() ? (userSnap.data() as UserProfile) : null;
      setProfile(userProf);

      const userMemberships = await listUserMemberships(currentUser.uid);
      let invites: Invitation[] = [];
      if (currentUser.email && currentUser.emailVerified) {
        try {
          invites = await listPendingInvitationsForEmail(currentUser.email);
        } catch {
          invites = [];
        }
      }

      setMemberships(userMemberships);
      setPendingInvitations(invites);

      const preferredOrgId =
        userProf?.activeOrganisationId &&
        userMemberships.some((m) => m.organisationId === userProf.activeOrganisationId)
          ? userProf.activeOrganisationId
          : userMemberships[0]?.organisationId;

      if (preferredOrgId) {
        await loadOrganisationDetails(currentUser, preferredOrgId);
      } else {
        setActiveOrg(null);
        setActiveMember(null);
        setSites([]);
        setDepartments([]);
        setMembers([]);
      }
    } catch (err) {
      console.error('Error loading user context:', err);
    } finally {
      setLoadingContext(false);
    }
  }, [loadOrganisationDetails]);

  React.useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
      if (firebaseUser) {
        await refreshContext();
      } else {
        setProfile(null);
        setMemberships([]);
        setPendingInvitations([]);
        setActiveOrg(null);
        setActiveMember(null);
      }
    });
    return () => unsubscribe();
  }, [refreshContext]);

  const switchOrganisation = React.useCallback(
    async (orgId: string) => {
      if (!user) return;
      setLoadingContext(true);
      try {
        await setActiveOrganisationForUser(user.uid, orgId);
        await loadOrganisationDetails(user, orgId);
      } finally {
        setLoadingContext(false);
      }
    },
    [user, loadOrganisationDetails]
  );

  const actor: ActorContext | null = React.useMemo(() => {
    if (!user || !activeMember) return null;
    return {
      uid: user.uid,
      displayName: activeMember.displayName || user.displayName || user.email || 'User',
      email: user.email || activeMember.email,
      role: activeMember.role,
    };
  }, [user, activeMember]);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        authReady,
        loadingContext,
        memberships,
        pendingInvitations,
        activeOrg,
        activeMember,
        sites,
        departments,
        members,
        selectedSiteId,
        setSelectedSiteId,
        selectedDepartmentId,
        setSelectedDepartmentId,
        switchOrganisation,
        refreshContext,
        actor,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
