import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, getProvisioningAuth, handleFirestoreError, OperationType } from '../lib/firebase';
import type { Invitation, UserMembership, UserProfile } from '../types/domain';

export async function ensureAuthPersistence(): Promise<void> {
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (err) {
    console.warn('Auth persistence fallback:', err);
  }
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  await ensureAuthPersistence();
  const result = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
  await syncUserProfile(result.user);
  return result.user;
}

export async function registerWithEmail(email: string, password: string, displayName: string): Promise<User> {
  await ensureAuthPersistence();
  const result = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
  await updateProfile(result.user, { displayName: displayName.trim() });
  await syncUserProfile(result.user);
  return result.user;
}

export async function provisionAuthUserWithoutLogout(params: {
  email: string;
  password: string;
  displayName: string;
  allowExisting?: boolean;
}): Promise<{ uid: string; email: string; displayName: string }> {
  const provAuth = getProvisioningAuth();
  const normalizedEmail = params.email.trim().toLowerCase();
  const cleanName = params.displayName.trim() || normalizedEmail.split('@')[0] || 'Operator';

  try {
    const cred = await createUserWithEmailAndPassword(provAuth, normalizedEmail, params.password);
    await updateProfile(cred.user, { displayName: cleanName });
    return {
      uid: cred.user.uid,
      email: normalizedEmail,
      displayName: cleanName,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (params.allowExisting && msg.includes('auth/email-already-in-use')) {
      const existing = await signInWithEmailAndPassword(provAuth, normalizedEmail, params.password);
      if (!existing.user.displayName) {
        await updateProfile(existing.user, { displayName: cleanName });
      }
      return {
        uid: existing.user.uid,
        email: normalizedEmail,
        displayName: existing.user.displayName || cleanName,
      };
    }
    throw err;
  } finally {
    try {
      await signOut(provAuth);
    } catch {
      // ignore signout errors on secondary app
    }
  }
}

export async function requestPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim().toLowerCase());
}

export async function logoutUser(): Promise<void> {
  await signOut(auth);
}

export async function syncUserProfile(user: User): Promise<UserProfile | null> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const profile: UserProfile = {
        uid: user.uid,
        email: (user.email || '').toLowerCase(),
        displayName: user.displayName || user.email?.split('@')[0] || 'Operator',
        ...(user.photoURL ? { photoURL: user.photoURL } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(ref, profile);
      return profile;
    }
    return snap.data() as UserProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function setActiveOrganisationForUser(uid: string, orgId: string): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      activeOrganisationId: orgId,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function listUserMemberships(uid: string): Promise<UserMembership[]> {
  const path = 'user_memberships';
  try {
    const q = query(collection(db, path), where('userId', '==', uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as UserMembership).filter((m) => m.status === 'active');
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listPendingInvitationsForEmail(email: string): Promise<Invitation[]> {
  if (!email) return [];
  const normalized = email.trim().toLowerCase();
  const path = 'invitations';
  try {
    const q = query(collection(db, path), where('email', '==', normalized));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as Invitation)
      .filter((inv) => inv.status === 'pending');
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function acceptInvitation(user: User, invitation: Invitation): Promise<void> {
  const membershipId = `${invitation.organisationId}_${user.uid}`;
  const batch = writeBatch(db);

  const memberRef = doc(db, 'organisations', invitation.organisationId, 'members', user.uid);
  batch.set(memberRef, {
    userId: user.uid,
    organisationId: invitation.organisationId,
    email: (user.email || invitation.email).toLowerCase(),
    displayName: user.displayName || user.email?.split('@')[0] || 'Team Member',
    role: invitation.role,
    siteIds: invitation.siteIds,
    departmentIds: invitation.departmentIds,
    status: 'active',
    inviteId: invitation.id,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const userMemRef = doc(db, 'user_memberships', membershipId);
  batch.set(userMemRef, {
    id: membershipId,
    organisationId: invitation.organisationId,
    organisationName: invitation.organisationName,
    userId: user.uid,
    role: invitation.role,
    status: 'active',
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const inviteRef = doc(db, 'invitations', invitation.id);
  batch.update(inviteRef, {
    status: 'accepted',
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    await setActiveOrganisationForUser(user.uid, invitation.organisationId);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `organisations/${invitation.organisationId}/members/${user.uid}`);
  }
}
