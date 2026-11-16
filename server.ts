import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const TARGET_FIELD_GUIDE: Record<string, { description: string; fields: Record<string, { type: Type; description: string }> }> = {
  production_logs: {
    description: 'Manufacturing production log sheet',
    fields: {
      productionDate: { type: Type.STRING, description: 'ISO date YYYY-MM-DD' },
      productionLine: { type: Type.STRING, description: 'Production line name or code' },
      machine: { type: Type.STRING, description: 'Machine or equipment name' },
      shift: { type: Type.STRING, description: 'Shift identifier (Shift A, Shift B, Shift C)' },
      product: { type: Type.STRING, description: 'Product or SKU name' },
      targetQuantity: { type: Type.NUMBER, description: 'Planned target production units' },
      actualQuantity: { type: Type.NUMBER, description: 'Actual produced units' },
      rejectedQuantity: { type: Type.NUMBER, description: 'Rejected/scrap units' },
      supervisor: { type: Type.STRING, description: 'Supervisor name' },
      remarks: { type: Type.STRING, description: 'Additional notes or remarks' },
    },
  },
  quality_logs: {
    description: 'Quality control or laboratory inspection certificate',
    fields: {
      inspectionDate: { type: Type.STRING, description: 'ISO date YYYY-MM-DD' },
      batchOrProduct: { type: Type.STRING, description: 'Product or batch identifier' },
      parameter: { type: Type.STRING, description: 'Measured quality parameter' },
      measuredValue: { type: Type.NUMBER, description: 'Numeric measured value' },
      unit: { type: Type.STRING, description: 'Measurement unit' },
      minLimit: { type: Type.NUMBER, description: 'Lower acceptance limit' },
      maxLimit: { type: Type.NUMBER, description: 'Upper acceptance limit' },
      inspector: { type: Type.STRING, description: 'Inspector name' },
      notes: { type: Type.STRING, description: 'Inspection remarks' },
    },
  },
  work_permits: {
    description: 'Permit-to-Work (PTW) authorization form',
    fields: {
      permitNumber: { type: Type.STRING, description: 'Permit reference number' },
      permitType: { type: Type.STRING, description: 'Hot Work, Confined Space, Electrical Work, or Work at Height' },
      location: { type: Type.STRING, description: 'Facility area or equipment location' },
      contractor: { type: Type.STRING, description: 'Contractor or executing team name' },
      responsiblePerson: { type: Type.STRING, description: 'Responsible supervisor name' },
      startDateTime: { type: Type.STRING, description: 'ISO datetime YYYY-MM-DDTHH:mm' },
      endDateTime: { type: Type.STRING, description: 'ISO datetime YYYY-MM-DDTHH:mm' },
      hazards: { type: Type.STRING, description: 'Identified hazards' },
      precautions: { type: Type.STRING, description: 'Required safety precautions and PPE' },
    },
  },
  incidents: {
    description: 'EHS safety incident or near-miss report',
    fields: {
      incidentDateTime: { type: Type.STRING, description: 'ISO datetime YYYY-MM-DDTHH:mm' },
      location: { type: Type.STRING, description: 'Incident location' },
      category: { type: Type.STRING, description: 'Incident category (Near Miss, First Aid, LTI, Spill, Fire)' },
      severity: { type: Type.STRING, description: 'minor, moderate, major, or critical' },
      description: { type: Type.STRING, description: 'Detailed description of what occurred' },
      peopleInvolved: { type: Type.STRING, description: 'Roles or count of people involved' },
      immediateAction: { type: Type.STRING, description: 'Immediate containment or first aid taken' },
    },
  },
  compliance_records: {
    description: 'Regulatory certificate or license document',
    fields: {
      requirement: { type: Type.STRING, description: 'Regulatory standard or requirement' },
      certificationName: { type: Type.STRING, description: 'Certificate or license name' },
      issuingAuthority: { type: Type.STRING, description: 'Issuing government or certification body' },
      issueDate: { type: Type.STRING, description: 'Issue date YYYY-MM-DD' },
      expiryDate: { type: Type.STRING, description: 'Expiry date YYYY-MM-DD' },
      responsiblePerson: { type: Type.STRING, description: 'Owner responsible for renewal' },
    },
  },
  environmental_records: {
    description: 'Utility bill, environmental meter log, or waste manifest',
    fields: {
      metricType: { type: Type.STRING, description: 'One of: water_consumption, electricity_consumption, fuel_consumption, waste_generation, emissions_data, environmental_inspection' },
      reportingPeriod: { type: Type.STRING, description: 'Billing or reporting period (e.g. 2026-10)' },
      sourceName: { type: Type.STRING, description: 'Meter, utility, or waste stream name' },
      value: { type: Type.NUMBER, description: 'Numeric consumption or quantity value' },
      unit: { type: Type.STRING, description: 'Unit such as kWh, m3, liters, kg, tonnes' },
      notes: { type: Type.STRING, description: 'Source document reference or notes' },
    },
  },
};

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '20mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'mushai-systems',
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/api/ai/extract-document', async (req: Request, res: Response) => {
    try {
      const { base64Data, mimeType, targetRecordType, fileName } = req.body as {
        base64Data?: string;
        mimeType?: string;
        targetRecordType?: string;
        fileName?: string;
      };

      if (!base64Data || !mimeType || !targetRecordType) {
        res.status(400).json({ error: 'Missing required fields: base64Data, mimeType, targetRecordType.' });
        return;
      }

      const guide = TARGET_FIELD_GUIDE[targetRecordType];
      if (!guide) {
        res.status(400).json({ error: `Unsupported targetRecordType: ${targetRecordType}` });
        return;
      }

      const ai = getGeminiClient();
      if (!ai) {
        res.status(503).json({
          error: 'Gemini API key is not configured on the server. Configure GEMINI_API_KEY in Settings > Secrets.',
        });
        return;
      }

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
            {
              text: `You are an industrial document extraction engine for Mushai Systems.
Extract structured fields from this ${guide.description} (filename: ${fileName || 'document'}).
Return JSON matching the schema.
Rules:
- Only extract values clearly observed in the document. If a field is illegible, missing, or ambiguous, omit or leave empty/0 and list the field key inside "uncertainFields".
- Flag any critical numeric quantities, dates, limits, or permit end times that need human verification inside "uncertainFields".
- Never fabricate regulatory compliance certifications.`,
            },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              extractedData: {
                type: Type.OBJECT,
                properties: guide.fields,
              },
              uncertainFields: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Field names that are uncertain, missing, or critical and require human verification.',
              },
            },
            required: ['extractedData', 'uncertainFields'],
          },
        },
      });

      const rawText = (response.text || '{}').trim();
      const parsed = JSON.parse(rawText) as {
        extractedData?: Record<string, unknown>;
        uncertainFields?: string[];
      };

      res.json({
        extractedData: parsed.extractedData || {},
        uncertainFields: Array.isArray(parsed.uncertainFields) ? parsed.uncertainFields : [],
        modelUsed: 'gemini-4-hydrogen',
      });
    } catch (error) {
      console.error('AI extraction error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to extract document data',
      });
    }
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Mushai Systems server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
