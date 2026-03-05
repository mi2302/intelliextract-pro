
import { GoogleGenAI, Type } from "@google/genai";
import { ObjectGroup, TransformationType, DatabaseConfig, FileSpecification, DBType } from "../types";

/**
 * Generates a SQL statement based on the extraction specification and data model, accounting for DB dialect.
 */
export async function generateSQLFromSpec(spec: FileSpecification, group: ObjectGroup): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const dialect = group.databaseType === 'ORACLE' ? 'Oracle (ATP/DBCS)' : 'PostgreSQL';

  const prompt = `Act as a senior ${dialect} SQL Developer. Based on this Data Model: ${JSON.stringify(group)} 
  and this Extraction Specification: ${JSON.stringify(spec)}, 
  generate a robust SQL SELECT statement compatible with ${dialect}.
  
  Dialect Specifics:
  - If Oracle: use appropriate quotes, schema prefixes, and functions (e.g., SYSDATE, TO_CHAR).
  - If Postgres: use appropriate identifier quoting and types.
  
  CRITICAL: If the specification includes "filters", you MUST implement them in a WHERE clause.
  Use the relationships defined in the model. If transformations are specified, represent them in ${dialect} SQL (e.g., UPPER(), TRIM(), CASE WHEN) if possible.
  Return only the SQL string.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt
  });

  return response.text || `-- Could not generate ${dialect} SQL`;
}

/**
 * Generates realistic mock data for the extraction preview.
 */
export async function generateMockDataForSpec(spec: FileSpecification, count: number = 5): Promise<any[]> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const properties: Record<string, any> = {};

  if (!spec.columns || spec.columns.length === 0) {
    return [];
  }

  spec.columns.forEach(col => {
    const key = col.targetName || 'field_' + col.id;
    properties[key] = {
      type: Type.STRING,
      description: `Realistic mock value for column ${key} sourced from ${col.sourceField}`
    };
  });

  const prompt = `Generate ${count} rows of realistic mock data for the following extraction specification: ${JSON.stringify(spec)}.
  Ensure the data respects the column names, the likely content based on the source field names, and the FILTER conditions if any are provided.
  Return an array of objects where keys match exactly the targetName of the provided columns.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: properties,
          required: Object.keys(properties)
        }
      }
    }
  });

  try {
    return JSON.parse(response.text || '[]');
  } catch (e) {
    console.error("Failed to parse mock data JSON", e);
    return [];
  }
}

export interface AISpecificationResponse {
  objectGroupId?: string;
  specName?: string;
  format?: string;
  columns?: {
    sourceField: string;
    targetName: string;
    suggestedTransformations?: string[];
  }[];
}

export async function processNaturalLanguageQuery(query: string, metadata: ObjectGroup[]): Promise<AISpecificationResponse> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `The user wants to generate a file. Query: "${query}". 
  Based on this metadata: ${JSON.stringify(metadata)}, determine:
  1. Which Object Group (and its associated DB dialect) they refer to.
  2. Which columns (Object.Field) they likely need.
  3. Desired export format (xls, csv, pipe, psv).
  4. Any required transformations.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          objectGroupId: { type: Type.STRING },
          specName: { type: Type.STRING },
          format: { type: Type.STRING },
          columns: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                sourceField: { type: Type.STRING },
                targetName: { type: Type.STRING },
                suggestedTransformations: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                }
              },
              required: ["sourceField", "targetName"]
            }
          }
        },
        required: ["objectGroupId"]
      }
    }
  });
  return JSON.parse(response.text || '{}');
}

export async function suggestTransformations(columnName: string, sourceField: string, metadata: ObjectGroup[]): Promise<TransformationType[]> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `Suggest transformations for "${columnName}" from "${sourceField}". Model: ${JSON.stringify(metadata)}. 
  Available: ${Object.values(TransformationType).join(', ')}.`;
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
    }
  });
  const raw = JSON.parse(response.text || '[]');
  return raw.filter((t: string) => Object.values(TransformationType).includes(t as TransformationType)) as TransformationType[];
}

export async function introspectDatabase(config: DatabaseConfig): Promise<ObjectGroup> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const dialect = config.type === 'ORACLE' ? 'Oracle (ATP/DBCS)' : 'PostgreSQL';

  const prompt = `Act as a database architect. Introspect a ${dialect} database named "${config.database}". 
  Generate an 'ObjectGroup' with 3+ tables and relationships specific to ${dialect} typical schemas.
  Include databaseType as "${config.type}" in the response.
  Ensure the response follows this schema strictly:
  {
    "id": "string",
    "name": "string",
    "databaseType": "${config.type}",
    "objects": [{"id": "string", "name": "string", "tableName": "string", "fields": [{"name": "string", "type": "STRING|NUMBER|DATE|BOOLEAN", "description": "string"}]}],
    "relationships": [{"sourceObjectId": "string", "targetObjectId": "string", "joinType": "INNER|LEFT", "condition": "string"}]
  }`;
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: { responseMimeType: "application/json" }
  });
  const parsed = JSON.parse(response.text || '{}');
  return {
    id: parsed.id || `grp_${Date.now()}`,
    name: parsed.name || `Introspected ${dialect} Model`,
    databaseType: config.type,
    objects: parsed.objects || [],
    relationships: parsed.relationships || []
  } as ObjectGroup;
}

export async function inferModelFromFile(fileName: string, content: string, targetDialect: DBType = 'POSTGRES'): Promise<ObjectGroup> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const dialect = targetDialect === 'ORACLE' ? 'Oracle' : 'PostgreSQL';

  const prompt = `Analyze file "${fileName}" and infer a data model optimized for ${dialect}.
  Content: ${content.substring(0, 10000)}
  Ensure the response follows this schema strictly:
  {
    "id": "string",
    "name": "string",
    "databaseType": "${targetDialect}",
    "objects": [{"id": "string", "name": "string", "tableName": "string", "fields": [{"name": "string", "type": "STRING|NUMBER|DATE|BOOLEAN", "description": "string"}]}],
    "relationships": [{"sourceObjectId": "string", "targetObjectId": "string", "joinType": "INNER|LEFT", "condition": "string"}]
  }`;
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: { responseMimeType: "application/json" }
  });
  const parsed = JSON.parse(response.text || '{}');
  return {
    id: parsed.id || `grp_${Date.now()}`,
    name: parsed.name || `Inferred ${dialect} Model`,
    databaseType: targetDialect,
    objects: parsed.objects || [],
    relationships: parsed.relationships || []
  } as ObjectGroup;
}

export interface FBDIAnalysisResult {
  productFamily?: string;
  moduleName: string;
  possibleModules?: string[];
  mainObject?: string;
  intent: string;
  confidence: 'High' | 'Medium' | 'Low';
  reasoning?: string;
}

export async function analyzeFbdiMetadata(metadata: {
  sheetNames: string[],
  instructions: string,
  props: Record<string, any>,
  fileName: string
}): Promise<FBDIAnalysisResult> {
  // Call Backend API (Proxies to OCI GenAI)
  try {
    const response = await fetch('http://localhost:3006/api/analyze-fbdi', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(metadata)
    });

    if (!response.ok) {
      throw new Error(`Backend Analysis Failed: ${response.statusText}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error("AI Analysis Failed (Backend)", error);
    return {
      moduleName: "Unknown",
      intent: "Unknown",
      confidence: "Low",
      reasoning: "Connection Error: " + (error as Error).message
    };
  }
}
