import * as React from 'react';
import type { ZodTypeAny } from 'zod';
import { Upload, Save, Send, AlertCircle } from 'lucide-react';
import type { Department, OrgMember, Site } from '../../types/domain';
import { uploadOrganisationFile } from '../../services/storageService';
import { Button } from '../ui/Button';
import { Input, Label, Textarea } from '../ui/Input';
import { Select } from '../ui/Select';

export type UniversalFieldType =
  | 'text'
  | 'number'
  | 'decimal'
  | 'date'
  | 'datetime'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'file'
  | 'user'
  | 'site'
  | 'department'
  | 'textarea';

export interface UniversalFieldDef {
  name: string;
  label: string;
  type: UniversalFieldType;
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  defaultValue?: unknown;
  colSpan?: 1 | 2;
  helperText?: string;
}

export interface UniversalFormProps {
  formId: string;
  orgId: string;
  fields: UniversalFieldDef[];
  schema: ZodTypeAny;
  sites: Site[];
  departments: Department[];
  members: OrgMember[];
  initialValues?: Record<string, unknown>;
  moduleAccent?: 'core' | 'nexus' | 'environ';
  allowDraft?: boolean;
  submitLabel?: string;
  renderCalculatedSummary?: (values: Record<string, unknown>) => React.ReactNode;
  onSubmit: (values: Record<string, unknown>, mode: 'submit' | 'draft') => Promise<void>;
  onCancel?: () => void;
}

export function UniversalForm({
  formId,
  orgId,
  fields,
  schema,
  sites,
  departments,
  members,
  initialValues,
  moduleAccent = 'core',
  allowDraft = true,
  submitLabel = 'Submit Record',
  renderCalculatedSummary,
  onSubmit,
  onCancel,
}: UniversalFormProps) {
  const draftStorageKey = `mushai_draft_${orgId}_${formId}`;

  const [values, setValues] = React.useState<Record<string, unknown>>(() => {
    const base: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.defaultValue !== undefined) base[f.name] = f.defaultValue;
      else if (f.type === 'multiselect') base[f.name] = [];
      else if (f.type === 'checkbox') base[f.name] = false;
      else base[f.name] = '';
    }
    if (initialValues) {
      Object.assign(base, initialValues);
    } else if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(draftStorageKey);
        if (saved) Object.assign(base, JSON.parse(saved));
      } catch {
        // Ignore storage errors
      }
    }
    return base;
  });

  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [uploadingField, setUploadingField] = React.useState<string | null>(null);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const selectedSiteId = String(values.siteId || '');
  const filteredDepartments = React.useMemo(() => {
    if (!selectedSiteId) return departments;
    return departments.filter((d) => d.siteId === selectedSiteId);
  }, [departments, selectedSiteId]);

  const setFieldValue = (name: string, val: unknown) => {
    setValues((prev) => {
      const next = { ...prev, [name]: val };
      if (name === 'siteId' && next.departmentId) {
        const deptStillValid = departments.some((d) => d.id === next.departmentId && d.siteId === val);
        if (!deptStillValid) next.departmentId = '';
      }
      return next;
    });
    setErrors((prev) => {
      if (!prev[name]) return prev;
      const copy = { ...prev };
      delete copy[name];
      return copy;
    });
  };

  const handleFileUpload = async (fieldName: string, file: File | null) => {
    if (!file) return;
    setUploadingField(fieldName);
    setSubmitError(null);
    try {
      const uploaded = await uploadOrganisationFile(orgId, 'attachments', file, file.name);
      setFieldValue(fieldName, uploaded.url);
    } catch (err) {
      // Fallback: keep local filename reference if Storage bucket isn't provisioned with CORS yet
      setFieldValue(fieldName, `attachment://${file.name}`);
      setSubmitError(
        err instanceof Error
          ? `Cloud Storage upload notice (${err.message}). File reference attached locally.`
          : 'File attached by reference.'
      );
    } finally {
      setUploadingField(null);
    }
  };

  const handleSaveLocalDraft = () => {
    try {
      localStorage.setItem(draftStorageKey, JSON.stringify(values));
    } catch {
      // Ignore
    }
  };

  const executeSubmit = async (mode: 'submit' | 'draft') => {
    setSubmitError(null);
    if (mode === 'submit') {
      const parsed = schema.safeParse(values);
      if (!parsed.success) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const pathKey = String(issue.path[0] || '_form');
          if (!fieldErrors[pathKey]) {
            fieldErrors[pathKey] = issue.message;
          }
        }
        setErrors(fieldErrors);
        setSubmitError('Please review the highlighted fields before submitting.');
        return;
      }
      setSubmitting(true);
      try {
        await onSubmit(parsed.data as Record<string, unknown>, 'submit');
        localStorage.removeItem(draftStorageKey);
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Failed to save record');
      } finally {
        setSubmitting(false);
      }
    } else {
      handleSaveLocalDraft();
      if (!values.siteId && sites[0]) {
        values.siteId = sites[0].id;
      }
      setSubmitting(true);
      try {
        await onSubmit(values, 'draft');
        localStorage.removeItem(draftStorageKey);
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Failed to save draft');
      } finally {
        setSubmitting(false);
      }
    }
  };

  const buttonVariant = moduleAccent === 'nexus' ? 'nexus' : moduleAccent === 'environ' ? 'environ' : 'primary';

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void executeSubmit('submit');
      }}
      className="space-y-5"
    >
      {submitError && (
        <div className="flex items-start gap-2.5 rounded-md border border-[#fecaca] bg-[#fef2f2] px-3.5 py-2.5 text-xs text-[#b91c1c]">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{submitError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {fields.map((field) => {
          const val = values[field.name];
          const err = errors[field.name];
          const colClass = field.colSpan === 2 || field.type === 'textarea' ? 'md:col-span-2' : '';

          return (
            <div key={field.name} className={colClass}>
              {field.type !== 'checkbox' && (
                <Label htmlFor={`${formId}_${field.name}`}>
                  {field.label}
                  {field.required && <span className="text-[#e60018] ml-0.5">*</span>}
                </Label>
              )}

              {field.type === 'text' && (
                <Input
                  id={`${formId}_${field.name}`}
                  value={String(val ?? '')}
                  placeholder={field.placeholder}
                  onChange={(e) => setFieldValue(field.name, e.target.value)}
                />
              )}

              {(field.type === 'number' || field.type === 'decimal') && (
                <Input
                  id={`${formId}_${field.name}`}
                  type="number"
                  step={field.type === 'decimal' ? '0.01' : '1'}
                  value={val === '' || val === undefined ? '' : String(val)}
                  placeholder={field.placeholder}
                  onChange={(e) => setFieldValue(field.name, e.target.value === '' ? '' : Number(e.target.value))}
                  className="font-mono-tabular"
                />
              )}

              {field.type === 'date' && (
                <Input
                  id={`${formId}_${field.name}`}
                  type="date"
                  value={String(val ?? '')}
                  onChange={(e) => setFieldValue(field.name, e.target.value)}
                  className="font-mono-tabular"
                />
              )}

              {field.type === 'datetime' && (
                <Input
                  id={`${formId}_${field.name}`}
                  type="datetime-local"
                  value={String(val ?? '')}
                  onChange={(e) => setFieldValue(field.name, e.target.value)}
                  className="font-mono-tabular"
                />
              )}

              {field.type === 'textarea' && (
                <Textarea
                  id={`${formId}_${field.name}`}
                  value={String(val ?? '')}
                  placeholder={field.placeholder}
                  onChange={(e) => setFieldValue(field.name, e.target.value)}
                />
              )}

              {field.type === 'select' && (
                <Select
                  id={`${formId}_${field.name}`}
                  value={String(val ?? '')}
                  placeholder={field.placeholder || `Select ${field.label.toLowerCase()}`}
                  options={field.options || []}
                  onChange={(e) => setFieldValue(field.name, e.target.value)}
                />
              )}

              {field.type === 'site' && (
                <Select
                  id={`${formId}_${field.name}`}
                  value={String(val ?? '')}
                  placeholder="Select plant / site"
                  options={sites.filter((s) => s.status === 'active').map((s) => ({
                    value: s.id,
                    label: `${s.name} (${s.code})`,
                  }))}
                  onChange={(e) => setFieldValue(field.name, e.target.value)}
                />
              )}

              {field.type === 'department' && (
                <Select
                  id={`${formId}_${field.name}`}
                  value={String(val ?? '')}
                  placeholder="Select department"
                  options={filteredDepartments.filter((d) => d.status === 'active').map((d) => ({
                    value: d.id,
                    label: `${d.name} (${d.code})`,
                  }))}
                  onChange={(e) => setFieldValue(field.name, e.target.value)}
                />
              )}

              {field.type === 'user' && (
                <Select
                  id={`${formId}_${field.name}`}
                  value={String(val ?? '')}
                  placeholder="Select team member"
                  options={members.filter((m) => m.status === 'active').map((m) => ({
                    value: m.displayName,
                    label: `${m.displayName} (${m.role.replace('_', ' ')})`,
                  }))}
                  onChange={(e) => setFieldValue(field.name, e.target.value)}
                />
              )}

              {field.type === 'multiselect' && (
                <div className="flex flex-wrap gap-2 rounded-md border border-[#d9dfe5] p-2.5 bg-white">
                  {(field.options || []).map((opt) => {
                    const selected = Array.isArray(val) ? val.includes(opt.value) : false;
                    return (
                      <label key={opt.value} className="inline-flex items-center gap-1.5 text-xs text-[#070e16] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(e) => {
                            const prevArr = Array.isArray(val) ? [...val] : [];
                            if (e.target.checked) prevArr.push(opt.value);
                            else {
                              const idx = prevArr.indexOf(opt.value);
                              if (idx >= 0) prevArr.splice(idx, 1);
                            }
                            setFieldValue(field.name, prevArr);
                          }}
                          className="rounded border-[#d9dfe5]"
                        />
                        <span>{opt.label}</span>
                      </label>
                    );
                  })}
                </div>
              )}

              {field.type === 'checkbox' && (
                <label className="inline-flex items-center gap-2 text-sm text-[#070e16] cursor-pointer pt-2">
                  <input
                    id={`${formId}_${field.name}`}
                    type="checkbox"
                    checked={Boolean(val)}
                    onChange={(e) => setFieldValue(field.name, e.target.checked)}
                    className="h-4 w-4 rounded border-[#d9dfe5]"
                  />
                  <span>{field.label}</span>
                </label>
              )}

              {field.type === 'file' && (
                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-[#d9dfe5] bg-[#f9fafc] hover:bg-[#edf2f8] text-xs font-medium text-[#070e16] cursor-pointer">
                    <Upload className="h-3.5 w-3.5" />
                    {uploadingField === field.name ? 'Uploading...' : 'Attach File'}
                    <input
                      type="file"
                      className="hidden"
                      onChange={(e) => void handleFileUpload(field.name, e.target.files?.[0] || null)}
                    />
                  </label>
                  <span className="text-xs text-[#555f69] truncate max-w-[240px]">
                    {val ? String(val) : 'No file attached'}
                  </span>
                </div>
              )}

              {field.helperText && !err && (
                <p className="text-[11px] text-[#555f69] mt-1">{field.helperText}</p>
              )}
              {err && <p className="text-[11px] text-[#e60018] mt-1">{err}</p>}
            </div>
          );
        })}
      </div>

      {renderCalculatedSummary && (
        <div className="rounded-md border border-[#d9dfe5] bg-[#f9fafc] p-3.5">
          {renderCalculatedSummary(values)}
        </div>
      )}

      <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#e9eef4]">
        {onCancel && (
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        )}
        {allowDraft && (
          <Button
            variant="secondary"
            disabled={submitting}
            onClick={() => void executeSubmit('draft')}
          >
            <Save className="h-3.5 w-3.5" />
            Save Draft
          </Button>
        )}
        <Button type="submit" variant={buttonVariant} disabled={submitting || uploadingField !== null}>
          <Send className="h-3.5 w-3.5" />
          {submitting ? 'Saving...' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
