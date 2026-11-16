import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../lib/firebase';

export async function uploadOrganisationFile(
  orgId: string,
  folder: 'attachments' | 'ai_documents' | 'reports',
  file: File | Blob,
  fileName: string
): Promise<{ url: string; storagePath: string }> {
  const safeName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const storagePath = `organisations/${orgId}/${folder}/${safeName}`;
  const storageRef = ref(storage, storagePath);

  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);
  return { url, storagePath };
}
