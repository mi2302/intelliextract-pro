import os
import oracledb
import oci
import json
import pandas as pd
import re
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from typing import List, Optional, Any, Dict
from datetime import datetime
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
import uvicorn
import traceback
import io
import zipfile
import csv
import shutil
from fastapi import UploadFile, File

# Load environment variables
load_dotenv()

app = FastAPI(title="FBDI Assistant API")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    print(f"Global Exception: {exc}")
    import traceback
    traceback.print_exc()
    return {"success": False, "message": str(exc)}

# Database Configuration
DB_USER = os.getenv("DB_USER")
DB_PWD = os.getenv("DB_PASSWORD", "").strip('"')
DB_HOST = os.getenv("DB_HOST")
DB_PORT = os.getenv("DB_PORT")
DB_SERVICE = os.getenv("DB_SERVICE_NAME")

dsn = f"{DB_HOST}:{DB_PORT}/{DB_SERVICE}"

# Initialize Oracle Client (Thick Mode)
try:
    instant_client_path = os.path.join(os.path.dirname(__file__), 'instantclient')
    if os.path.exists(instant_client_path):
        oracledb.init_oracle_client(lib_dir=instant_client_path)
    else:
        print("Warning: Instant Client not found in server directory, relying on system PATH")
except Exception as e:
    print(f"Failed to initialize Oracle Client: {e}")

# Global Pool Variable
db_pool = None

def initialize_pool():
    global db_pool
    try:
        db_pool = oracledb.create_pool(
            user=DB_USER,
            password=DB_PWD,
            dsn=dsn,
            min=2,
            max=10,
            increment=1
        )
        print("Oracle Connection Pool initialized")
    except Exception as e:
        print(f"Oracle DB Initialization Error: {e}")

# OCI Configuration
CONFIG_LOCATION = os.path.join(os.path.dirname(__file__), 'oci_config')
CONFIG_PROFILE = "DEFAULT"
# COMPARTMENT_ID = "ocid1.compartment.oc1..aaaaaaaalqcwboncf4xzqpfvtuygdriwomhjzrltllqnu63sflohbkirs5ia" # User's compartment
COMPARTMENT_ID = os.getenv("OCI_COMPARTMENT_ID", "ocid1.compartment.oc1..aaaaaaaalqcwboncf4xzqpfvtuygdriwomhjzrltllqnu63sflohbkirs5ia")
OCI_ENDPOINT = "https://inference.generativeai.uk-london-1.oci.oraclecloud.com"
EMBED_MODEL_ID = "cohere.embed-english-v3"
CHAT_MODEL_ID = "ocid1.generativeaimodel.oc1.uk-london-1.amaaaaaask7dceya6unpxszl2mdu5yhs7fos3mmyjp3xpw7kw2inpz2psdxq"

# --- Models ---
class ChatRequest(BaseModel):
    message: str
    context: Optional[dict] = None

class ModuleColumnsRequest(BaseModel):
    moduleName: Optional[str] = None
    sheetNames: Optional[List[str]] = []
    analysisModuleName: Optional[Any] = None
    unmappedHeaders: Optional[Any] = None

class FbdiMappingsRequest(BaseModel):
    moduleName: Optional[str] = None
    sheetNames: Optional[List[str]] = []
    analysisModuleName: Optional[Any] = None
    unmappedHeaders: Optional[Any] = None

class ExtractSpec(BaseModel):
    columns: List[dict]
    joins: Optional[List[dict]] = []
    filters: Optional[List[dict]] = []
    sheetName: Optional[str] = "Data"

class ExtractionRequest(BaseModel):
    columns: List[dict]
    joins: Optional[List[dict]] = []
    filters: Optional[List[dict]] = []
    limit: Optional[int] = None
    templateFile: Optional[str] = None
    sheetName: Optional[str] = "Data"
    exportFormat: Optional[str] = None

class BatchExtractionRequest(BaseModel):
    specs: List[ExtractSpec]
    exportFormat: str
    templateFile: Optional[str] = None

class GenerateSqlRequest(BaseModel):
    columns: List[dict]
    joins: Optional[List[dict]] = []
    filters: Optional[List[dict]] = []
    limit: Optional[int] = None

class SaveModelRequest(BaseModel):
    modelName: str
    templateName: Optional[str] = "UNKNOWN"
    username: Optional[str] = "GUEST"
    userId: Optional[str] = "1001"
    objects: List[dict]
    relationships: Optional[List[dict]] = []
    specs: Optional[List[dict]] = []

class UpdateArchitectureRequest(BaseModel):
    modelName: str
    objects: List[dict]
    relationships: Optional[List[dict]] = []

class UpdateExtractionRequest(BaseModel):
    modelId: int
    extractionName: str
    columns: List[dict]
    filters: Optional[List[dict]] = []
    sqlQuery: Optional[str] = ""
    templateName: Optional[str] = "UNKNOWN"
    isClone: Optional[bool] = False
    version: Optional[str] = "1.0"
    sheetName: Optional[str] = ""

# --- Helpers ---
def get_db_connection():
    if db_pool:
        return db_pool.acquire()
    return oracledb.connect(user=DB_USER, password=DB_PWD, dsn=dsn)

def quote_identifier(id_str):
    if not id_str or id_str == '*' or str(id_str).upper() == 'NULL':
        return id_str
    return f'"{id_str}"'

async def get_discovered_joins(conn, tables: List[str]):
    if not tables or len(tables) < 2:
        return []
    try:
        bind_params = {}
        bind_placeholders = []
        for i, t in enumerate(tables):
            key = f"tbl{i}"
            bind_params[key] = t.upper()
            bind_placeholders.append(f":{key}")
        
        bind_names_str = ", ".join(bind_placeholders)
        join_sql = f"""
            SELECT 
                source_table_name as "SOURCE_TABLE_NAME", 
                source_table_join_column1 as "SOURCE_TABLE_JOIN_COLUMN1", 
                target_table_name as "TARGET_TABLE_NAME", 
                target_table_join_column1 as "TARGET_TABLE_JOIN_COLUMN1",
                source_table_join_column2 as "SOURCE_TABLE_JOIN_COLUMN2",
                target_table_join_column2 as "TARGET_TABLE_JOIN_COLUMN2",
                match_type as "MATCH_TYPE",
                qualifier as "QUALIFIER"
            FROM XXEA_DM_TABLE_JOINS
            WHERE SOURCE_TABLE_NAME IN ({bind_names_str})
              AND TARGET_TABLE_NAME IN ({bind_names_str})
              AND SOURCE_TABLE_NAME != TARGET_TABLE_NAME
        """
        cursor = conn.cursor()
        cursor.execute(join_sql, bind_params)
        columns = [col[0] for col in cursor.description]
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
        
        results = []
        for row in rows:
            src_tbl = row['SOURCE_TABLE_NAME']
            tgt_tbl = row['TARGET_TABLE_NAME']
            src_col1 = row['SOURCE_TABLE_JOIN_COLUMN1']
            tgt_col1 = row['TARGET_TABLE_JOIN_COLUMN1']
            src_col2 = row['SOURCE_TABLE_JOIN_COLUMN2']
            tgt_col2 = row['TARGET_TABLE_JOIN_COLUMN2']
            q = row['QUALIFIER']
            
            condition = f"{src_tbl}.{src_col1} = {tgt_tbl}.{tgt_col1}"
            if src_col2 and tgt_col2:
                condition += f" AND {src_tbl}.{src_col2} = {tgt_tbl}.{tgt_col2}"
            if q:
                condition += f" AND ({q})"
                
            results.append({
                "sourceTable": src_tbl,
                "targetTable": tgt_tbl,
                "sourceColumn": src_col1,
                "targetColumn": tgt_col1,
                "condition": condition,
                "joinType": row.get('MATCH_TYPE') or 'LEFT'
            })
        return results
    except Exception as e:
        print(f"Join Discovery Error: {e}")
        return []

def map_oracle_type(ora_type):
    if not ora_type: return 'STRING'
    t = str(ora_type).upper()
    if any(k in t for k in ['CHAR', 'CLOB', 'XML']): return 'STRING'
    if any(k in t for k in ['NUMBER', 'FLOAT', 'INT']): return 'NUMBER'
    if any(k in t for k in ['DATE', 'TIMESTAMP']): return 'DATE'
    return 'STRING'

def to_title_case(s):
    if not s: return ''
    return re.sub(r'_', ' ', str(s)).strip().title()

def read_lob(v):
    if v is None: return ""
    if hasattr(v, 'read'): return v.read()
    return str(v)

def safe_json_load(val):
    if not val or val == "None": return []
    raw = read_lob(val)
    if not raw: return []
    try:
        if isinstance(raw, (list, dict)): return raw
        return json.loads(raw)
    except Exception as e:
        print(f"[safe_json_load] JSON Parse Error: {e}")
        try:
            # Basic cleanup if stored with single quotes
            import ast
            return ast.literal_eval(raw)
        except Exception as e2:
            print(f"[safe_json_load] Fallback ast.literal_eval also failed: {e2}")
            return []

# --- OCI Services ---
def get_oci_genai_client():
    config = oci.config.from_file(CONFIG_LOCATION, CONFIG_PROFILE)
    client = oci.generative_ai_inference.GenerativeAiInferenceClient(config)
    client.endpoint = OCI_ENDPOINT
    return client

def get_embedding(text: str):
    try:
        client = get_oci_genai_client()
        embed_details = oci.generative_ai_inference.models.EmbedTextDetails(
            compartment_id=COMPARTMENT_ID,
            serving_mode=oci.generative_ai_inference.models.OnDemandServingMode(model_id=EMBED_MODEL_ID),
            inputs=[text],
            truncate="NONE"
        )
        response = client.embed_text(embed_details)
        return response.data.embeddings[0]
    except Exception as e:
        print(f"Embedding Error: {e}")
        return None

# --- Mapping Logic Helpers ---
SYNONYM_MAP = {
    'SUPPLIER': ['VENDOR', 'SUPPLIER'],
    'VENDOR': ['SUPPLIER', 'VENDOR'],
    'BU': ['BUSINESS UNIT', 'BU'],
    'ORG': ['ORGANIZATION', 'ORG'],
    'REQ': ['REQUISITION', 'REQ'],
    'PO': ['PURCHASE ORDER', 'PO'],
    'DT': ['DATE', 'DT']
}

def get_expanded_terms(h: str):
    h = h.upper()
    terms = [h]
    for key, synonyms in SYNONYM_MAP.items():
        if key in h:
            for s in synonyms:
                terms.append(h.replace(key, s))
    return list(set(terms))

async def analyze_fbdi_with_oci(metadata: dict):
    try:
        client = get_oci_genai_client()
        candidate_groups_text = ", ".join(metadata.get('candidateGroups', []))
        
        sheet_details = metadata.get('sheetDetails', [])
        sheet_details_text = ""
        for sd in sheet_details:
            headers = sd.get('headers', [])
            infos = sd.get('headerInfos', [])
            header_report = ", ".join([f"{h}{' [' + infos[i] + ']' if i < len(infos) and infos[i] else ''}" for i, h in enumerate(headers)])
            sheet_details_text += f"Sheet: {sd.get('name')}\nHeaders & Metadata: {header_report}\nSample Data: {json.dumps(sd.get('sampleRows', []))}\n\n"

        prompt = f"""Analyze this Oracle FBDI Template to identify its position in the Oracle Fusion taxonomy.
        
        File Context:
        - File Name: {metadata.get('fileName')}
        - Subject/App Metadata: {metadata.get('props', {}).get('Subject') or metadata.get('props', {}).get('Application') or 'N/A'}
        - Sheet Names: {", ".join(metadata.get('sheetNames', []))}
        - Instruction Text Snippet: "{str(metadata.get('instructions', '')[:1500]).replace('\n', ' ')}"
        
        Detailed Sheet Info:
        {sheet_details_text}

        {f"Prior Knowledge (from Knowledge Base):\n{metadata.get('priorKnowledge')}" if metadata.get('priorKnowledge') else ''}
        
        Candidate Group Names (from our Database):
        [{candidate_groups_text}]

        Your Goal:
        1. Identify the Primary Object Owner / Product Family (e.g., 'Procurement', 'Financials', 'Project Management').
        2. Identify the Target Module / Functional Area / Product. 
           CRITICAL: You MUST pick the best matching value from the 'Candidate Group Names' list provided above for the 'moduleName' field.
        3. Identify the Main Business Object (e.g., 'Project', 'Supplier', 'Invoice', 'Journal').
        4. Identify the specific Business Intent.
        
        CRITICAL INSTRUCTION:
        - The 'moduleName' field MUST contain exactly one value from the 'Candidate Group Names' list.
        - If your confidence is 'Medium' or 'Low', populate the 'possibleModules' array with other relevant group names from the candidate list that could also apply.
        
        Output JSON format (strictly valid JSON):
        {{
           "productFamily": "Product Family",
           "moduleName": "Selected Group Name from candidates",
           "possibleModules": ["Secondary Group 1", "Secondary Group 2"],
           "mainObject": "Main Business Object Name",
           "intent": "string", 
           "confidence": "High" | "Medium" | "Low",
           "reasoning": "Brief explanation referencing the candidate list and template metadata."
        }}"""
        
        chat_details = oci.generative_ai_inference.models.ChatDetails(
            compartment_id=COMPARTMENT_ID,
            serving_mode=oci.generative_ai_inference.models.OnDemandServingMode(model_id=CHAT_MODEL_ID),
            chat_request=oci.generative_ai_inference.models.CohereChatRequest(message=prompt, max_tokens=800, temperature=0.1)
        )
        response = client.chat(chat_details)
        text = response.data.chat_result.chat_response.text
        clean_text = re.sub(r'```json\s*|\s*```', '', text).strip()
        json_match = re.search(r'\{.*\}', clean_text, re.DOTALL)
        return json.loads(json_match.group(0)) if json_match else {"moduleName": "Unknown"}
    except Exception as e:
        print(f"Analysis Failed: {e}")
        return {"moduleName": "Unknown"}

async def smart_map_columns_with_oci(headers: list, candidates: list, module_context: str, learned_mappings: list = [], extra_context: dict = {}):
    try:
        client = get_oci_genai_client()
        
        cand_summary = "\n".join([
            f"Group: \"{c.get('GROUP_NAME')}\", Table: {c.get('TABLE_NAME')}, Column: {c.get('COLUMN_NAME')}, Type: {c.get('DATA_TYPE', 'N/A')}, Required: {c.get('IS_REQUIRED', 'N/A')}, BusinessName: \"{c.get('METADATA_COLUMN_HEADER')}\", Description: \"{c.get('COLUMN_DESCRIPTION', 'N/A')}\", Table Context (Siblings): [{c.get('TABLE_CONTEXT', 'N/A')}]"
            for c in candidates
        ])

        learned_context = ""
        if learned_mappings:
            learned_str = "\n".join([f"Header: \"{m.get('DATA_IDENTIFIER')}\" -> mapped to Table: {m.get('TABLE_NAME')}, Column: {m.get('COLUMN_NAME')}" for m in learned_mappings])
            learned_context = f"\nPrior Knowledge (Golden Mappings for this module):\n{learned_str}\n"

        header_list_text = "\n".join([
            f"Header: \"{h.get('header')}\"{' (Metadata: ' + str(h.get('info')) + ')' if h.get('info') else ''}" if isinstance(h, dict) else str(h)
            for h in headers
        ])

        raw_instructions = str(extra_context.get('instructions', 'N/A'))
        instruction_snippet = raw_instructions[:1000] if raw_instructions else 'N/A'
        prompt = f"""You are an expert Oracle Fusion/EBS Functional Consultant and Data Architect.
Your task is to create a "High-Fidelity" metadata configuration by mapping Template Headers to Database Columns.

Contextual Guidance (Target Module): {module_context}{learned_context}

Template Context:
- Sheet Name: {extra_context.get('currentSheet', 'N/A')}
- All Sheet Names: {", ".join(extra_context.get('sheetNames', []))}
- Template Instructions: "{instruction_snippet}"

{f"Prior Knowledge (from Knowledge Base):\n{extra_context.get('priorKnowledge')}" if extra_context.get('priorKnowledge') else ''}

Template Headers to Map (with Source Descriptions):
{header_list_text}

Available Database Candidates (Enriched Metadata):
{cand_summary}

ADVANCED MAPPING RULES:
1.  **FUNCTIONAL MEANING IS KING**: Prioritize the **"Description"** (Column Comment) and **"Metadata"** (Source Description) over the literal column name. Oracle column names are often technical (e.g., SEGMENT1, ATTRIBUTE1); the description tells you what it actually is.
2.  **SEMANTIC SYNONYMS**: Align headers to columns based on functional purpose. **Crucially: "Supplier" and "Vendor" are 100% equivalent synonyms.** Similarly, "Business Unit" and "BU" are equivalent.
3.  **THE "INTERNAL COLUMN" HINT**: If the Header Info contains **"Internal Column: [NAME]"**, this is a direct directive from the template architect. You must prioritize mapping to a database column with that technical name if it exists in the candidates.
4.  **THE "GENERIC COLUMN" RULE**: If a Template Header name is generic (e.g., "Attribute 1", "Line Attribute 13"), YOU MUST rely 100% on the "Metadata" (Source Description/Bubble Text) provided in the header info.
5.  **THE "FLAG VS CODE" TRAP**: Be extremely careful with "FLAG" vs "CODE" or "NAME". Flags are usually 'Y'/'N'.
6.  **SIGNALS HIERARCHY**: Prioritize: Internal Column Hint -> Source Metadata (Comments/Row 3) -> DB Column Description -> Data Type -> Column Name.
7.  **DATATYPE GUARDRAIL**: Ensure the mapped column can logically store the source data.

Output your response as a raw JSON array of objects, including a confidence score (0-100) for each mapping:
[
  {{
    "DATA_IDENTIFIER": "Template Header Name",
    "TABLE_NAME": "Selected Table Name",
    "COLUMN_NAME": "Selected Column Name",
    "METADATA_COLUMN_HEADER": "Original DB Business Name/Description Match",
    "CONFIDENCE_SCORE": 95,
    "REASONING": "Brief justification based on rules"
  }}
]"""

        chat_details = oci.generative_ai_inference.models.ChatDetails(
            compartment_id=COMPARTMENT_ID,
            serving_mode=oci.generative_ai_inference.models.OnDemandServingMode(model_id=CHAT_MODEL_ID),
            chat_request=oci.generative_ai_inference.models.CohereChatRequest(message=prompt, max_tokens=1500, temperature=0.1)
        )
        response = client.chat(chat_details)
        text = response.data.chat_result.chat_response.text
        json_match = re.search(r'\[.*\]', text, re.DOTALL)
        return json.loads(json_match.group(0)) if json_match else []
    except Exception as e:
        print(f"Smart Map Failed: {e}")
        return []

async def rank_tables_with_oci(business_intent: str, tables: list, extra_context: dict = {}):
    try:
        client = get_oci_genai_client()
        table_list: List[dict] = tables
        table_summary_parts = [f"Table: {t.get('tableName')}, Comment: \"{t.get('comments')}\"" for t in table_list[:200]]
        table_summary = "\n".join(table_summary_parts)
        
        raw_instr = str(extra_context.get('instructions', 'N/A'))
        instr_snippet = raw_instr[:1000] if raw_instr else 'N/A'
        
        prompt = f"""You are an expert Oracle Fusion Data Architect. 
        Given a business intent: "{business_intent}"
        
        Template Context:
        - Sheet Names: {", ".join(extra_context.get('sheetNames', []))}
        - Instruction Snippet: "{instr_snippet}"
        
        {f"Prior Knowledge (from Knowledge Base):\n{extra_context.get('priorKnowledge')}" if extra_context.get('priorKnowledge') else ''}
        
        Database Tables (Oracle Fusion XXEA_MS Master Tables):
        {table_summary}
        
        Tasks:
        1. Analyze the business intent AND the template context (sheets/instructions) in deep detail.
        2. Identify ALL database tables that are functionally relevant to this business object. 
           - Do NOT just pick based on keyword match; use your functional knowledge of Oracle Fusion.
        3. Prioritize transaction and master data tables.
        4. Return a ranked list of the most relevant tables. Do not limit yourself to just 5 if more are relevant (up to 12).
        
        Output Strictly JSON array of table names:
        ["TABLE_NAME_1", "TABLE_NAME_2", ...]
        """

        chat_details = oci.generative_ai_inference.models.ChatDetails(
            compartment_id=COMPARTMENT_ID,
            serving_mode=oci.generative_ai_inference.models.OnDemandServingMode(model_id=CHAT_MODEL_ID),
            chat_request=oci.generative_ai_inference.models.CohereChatRequest(message=prompt, max_tokens=800, temperature=0.1)
        )
        response = client.chat(chat_details)
        text = response.data.chat_result.chat_response.text
        json_match = re.search(r'\[.*\]', text, re.DOTALL)
        return json.loads(json_match.group(0)) if json_match else []
    except Exception as e:
        print(f"Table Ranking Failed: {e}")
        return []

async def process_nl_query_with_oci(query: str, metadata: dict):
    try:
        client = get_oci_genai_client()
        prompt = f"User want to extract data: '{query}'. Meta: {json.dumps(metadata)}. Return JSON: objectGroupId, format, columns[sourceField, targetName]."
        chat_details = oci.generative_ai_inference.models.ChatDetails(
            compartment_id=COMPARTMENT_ID,
            serving_mode=oci.generative_ai_inference.models.OnDemandServingMode(model_id=CHAT_MODEL_ID),
            chat_request=oci.generative_ai_inference.models.CohereChatRequest(message=prompt, max_tokens=1000, temperature=0.1)
        )
        response = client.chat(chat_details)
        text = response.data.chat_result.chat_response.text
        json_match = re.search(r'\{.*\}', text, re.DOTALL)
        return json.loads(json_match.group(0)) if json_match else {"objectGroupId": None}
    except: return {"objectGroupId": None}

# --- Core Logic ---
async def get_filtered_mappings(conn, params: dict):
    module_name = params.get('moduleName')
    sheet_names = params.get('sheetNames', [])
    sql = ""
    binds = {}
    if sheet_names:
        placeholders = ",".join([f":sheet{i}" for i in range(len(sheet_names))])
        binds = {f"sheet{i}": s.upper() for i, s in enumerate(sheet_names)}
        sql = f"SELECT DATA_IDENTIFIER, TABLE_NAME, COLUMN_NAME, METADATA_COLUMN_HEADER FROM XX_INTELLI_RECON_TAB_COLUMN_MAPPING WHERE UPPER(DATA_IDENTIFIER) IN ({placeholders})"
    else:
        term = f"%{(module_name or '').upper()}%"
        binds = {"term": term}
        sql = "SELECT DATA_IDENTIFIER, TABLE_NAME, COLUMN_NAME, METADATA_COLUMN_HEADER FROM XX_INTELLI_RECON_TAB_COLUMN_MAPPING WHERE UPPER(DATA_IDENTIFIER) LIKE :term OR UPPER(DATA_GROUP) LIKE :term"
    
    cursor = conn.cursor()
    cursor.execute(sql, binds)
    cols = [c[0] for c in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]

async def get_saved_model_detail_internal(conn, model_id: str):
    cursor = conn.cursor()
    # 1. Get Model Basic Info
    cursor.execute("SELECT MODEL_NAME, TEMPLATENAME FROM XX_INTELLI_MODELS WHERE MODEL_ID = :b_id", {"b_id": model_id})
    m_res = cursor.fetchone()
    if not m_res: raise Exception(f"Model ID {model_id} not found")
    model_name = m_res[0]

    # 2. Get Architecture
    cursor.execute("SELECT TABLES, RELATIONSHIPS FROM XX_INTELLI_MODEL_ARCHITECTURE WHERE MODEL_NAME = :b_name", {"b_name": model_name})
    res = cursor.fetchone()
    tables_csv = read_lob(res[0]) if res and res[0] else ""
    stored_rels = safe_json_load(res[1]) if res and res[1] else []
    table_names = [t.strip() for t in (tables_csv or "").split(',') if t.strip()]

    # 3. Reconstruct Object Schema
    objects = []
    print(f"[get_saved_model_detail_internal] Reconstructing schema for tables: {table_names}")
    if table_names:
        placeholders = ",".join([f":tbl{i}" for i in range(len(table_names))])
        binds = {f"tbl{i}": t.upper() for i, t in enumerate(table_names)}
        cursor.execute(f"SELECT table_name, column_name, data_type FROM user_tab_columns WHERE table_name IN ({placeholders}) ORDER BY table_name, column_id", binds)
        rows = cursor.fetchall()
        print(f"[get_saved_model_detail_internal] Found {len(rows)} columns across tables")
        table_groups = {}
        for row in rows:
            t, c, d = row[0], row[1], row[2]
            if t not in table_groups: table_groups[t] = []
            table_groups[t].append({"name": c, "type": map_oracle_type(d), "description": d})
        
        for tn in table_names:
            u = tn.upper()
            if u in table_groups:
                objects.append({"id": tn, "name": to_title_case(tn), "tableName": tn, "fields": table_groups[u]})

    # 4. Get Latest Extractions
    print("[get_saved_model_detail_internal] Fetching latest extractions...")
    cursor.execute("""
        SELECT ID, EXTRACTION_NAME, COLUMN_MAPPINGS, EXTRACTION_SQL_QUERY, TEMPLATENAME, VERSION, DATA_FILTERS, SHEET_NAME 
        FROM XX_INTELLI_EXTRACTIONS e 
        WHERE MODEL_ID = :b_id 
        AND VERSION = (
            SELECT MAX(VERSION) FROM XX_INTELLI_EXTRACTIONS e2 
            WHERE e2.MODEL_ID = e.MODEL_ID AND e2.EXTRACTION_NAME = e.EXTRACTION_NAME
        )
    """, {"b_id": model_id})
    specs = []
    for r in cursor.fetchall():
        specs.append({
            "id": f"spec_db_{r[0]}",
            "name": r[1],
            "version": r[5] or "1.0",
            "objectGroupId": f"grp_db_{model_id}",
            "columns": safe_json_load(r[2]),
            "filters": safe_json_load(r[6]),
            "format": "csv" if "csv" in (r[4] or "").lower() else "fbdi",
            "backendTemplateName": r[4],
            "sheetName": r[7],
            "createdAt": datetime.now().isoformat()
        })

    # 5. Connect Relationships
    relationships: List[dict] = []
    if stored_rels:
        for r in stored_rels:
            if isinstance(r, dict):
                relationships.append({
                    "sourceObjectId": str(r.get("sourceObjectId", "")).replace("obj_", ""),
                    "targetObjectId": str(r.get("targetObjectId", "")).replace("obj_", ""),
                    "joinType": r.get("joinType", "INNER"),
                    "condition": r.get("condition")
                })
    else:
        discovered_joins: List[dict] = await get_discovered_joins(conn, table_names)
        for dj in discovered_joins:
            src_obj = next((o for o in objects if o['tableName'].upper() == str(dj.get('sourceTable', '')).upper()), None)
            tgt_obj = next((o for o in objects if o['tableName'].upper() == str(dj.get('targetTable', '')).upper()), None)
            if src_obj and tgt_obj:
                relationships.append({"sourceObjectId": src_obj['id'], "targetObjectId": tgt_obj['id'], "joinType": dj.get('joinType', 'INNER'), "condition": dj.get('condition')})

    return {
        "group": {"id": f"grp_db_{model_id}", "modelId": model_id, "name": model_name, "databaseType": "ORACLE", "objects": objects, "relationships": relationships},
        "specifications": specs
    }

async def build_extraction_query(conn, columns, joins, filters, limit=None, cache=None):
    if not columns: raise Exception('No columns specified')
    
    tables_with_version = (cache or {}).get('tablesWithVersion', set())
    discovered_joins_cache = (cache or {}).get('discoveredJoinsCache', {})

    query = 'SELECT '
    col_parts = []
    for c in columns:
        expr = c.get('expression') or f"{quote_identifier(c['table'])}.{quote_identifier(c['column'])}"
        if c.get('transformations'):
            for t in c['transformations']:
                if t['type'] == 'UPPERCASE': expr = f"UPPER({expr})"
                elif t['type'] == 'LOWERCASE': expr = f"LOWER({expr})"
                elif t['type'] == 'TRIM': expr = f"TRIM({expr})"
        col_parts.append(f'{expr} AS "{c["alias"]}"')
    query += ", ".join(col_parts)
    
    tables = list(set([c['table'] for c in columns if c.get('table')]))
    if not tables: 
        query += ' FROM DUAL'
    else:
        final_joins = list(joins or [])
        if len(tables) > 1:
            cache_key = ",".join(sorted(tables))
            if cache_key in discovered_joins_cache:
                discovered = discovered_joins_cache[cache_key]
            else:
                discovered = await get_discovered_joins(conn, tables)
                discovered_joins_cache[cache_key] = discovered
            
            for dj in discovered:
                if not any((fj.get('leftTable') == dj['sourceTable'] and fj.get('rightTable') == dj['targetTable']) or (fj.get('leftTable') == dj['targetTable'] and fj.get('rightTable') == dj['sourceTable']) for fj in final_joins):
                    final_joins.append({'leftTable': dj['sourceTable'], 'rightTable': dj['targetTable'], 'condition': dj['condition'], 'type': dj.get('joinType') or 'INNER'})

        query += f" FROM {', '.join([f'{quote_identifier(t)}' for t in tables])}"
        all_conditions = []
        for j in final_joins:
            if j.get('condition'):
                cond = j['condition']
                # for t in tables: cond = re.sub(rf'\b{t}\b', f"{t}", cond) # No prefix needed
                all_conditions.append(cond)
        
        if filters:
            for f in filters:
                if f.get('field') and f.get('operator'):
                    field = f['field']
                    if '.' in field:
                        t, c = field.split('.')
                        field = f"{quote_identifier(t)}.{quote_identifier(c)}"
                    
                    val = str(f['value']).replace("'", "''")
                    op = f['operator'].upper()
                    if op in ['IN', 'NOT IN']:
                        vals_list = [v.strip().replace("'", "''") for v in str(f['value']).split(',')]
                        vals = ", ".join([f"'{v}'" for v in vals_list])
                        all_conditions.append(f"{field} {op} ({vals})")
                    elif op in ['LIKE', 'NOT LIKE']:
                        all_conditions.append(f"{field} {op} '%{val}%'")
                    else:
                        all_conditions.append(f"{field} {op} '{val}'")

        if not tables_with_version and tables:
            cursor = conn.cursor()
            placeholders = ",".join([f":t{i}" for i in range(len(tables))])
            binds = {f"t{i}": t.upper() for i, t in enumerate(tables)}
            cursor.execute(f"SELECT table_name FROM all_tab_columns WHERE column_name = 'XX_VERSION' AND table_name IN ({placeholders})", binds)
            for r in cursor.fetchall(): tables_with_version.add(r[0])

        for t in tables:
            if t.upper() in tables_with_version:
                all_conditions.append(f"{quote_identifier(t)}.XX_VERSION = (SELECT MAX(XX_VERSION) FROM {quote_identifier(t)})")

        if all_conditions: query += " WHERE " + " AND ".join(all_conditions)
        if limit: query += f" FETCH NEXT {int(limit)} ROWS ONLY"
    return query

# --- AI Utility ---
ROUTER_PROMPT = """Classify: 1.DOCUMENTATION_SEARCH, 2.INGESTION_CONFIRMED, 3.GENERAL_CHAT. Return only category. Msg: {message}"""
SUPPLIER_PO_REGISTRY = {"Supplier": {"templates": [{"name": "Supplier Import", "url": "https://docs.oracle.com"}]}}

def discover_oer_template(query: str):
    if "supplier" in query.lower(): return SUPPLIER_PO_REGISTRY["Supplier"]["templates"][0]
    return ""

async def search_vector_knowledge(conn, query_text: Any = None, section_name: Optional[str] = None, limit: int = 20, use_metadata_table: bool = False, pre_generated_embedding: Optional[list] = None):
    try:
        target_table = 'INTELLI_FBDI_KNOWLEDGE_VECTOR_METADATA' if use_metadata_table else 'INTELLI_FBDI_KNOWLEDGE_VECTOR'
        
        if pre_generated_embedding:
            query_vec = json.dumps(pre_generated_embedding)
        else:
            q_str: str = " ".join(query_text) if isinstance(query_text, list) else str(query_text or '')
            if not q_str.strip(): return []
            q_preview = q_str[:50]
            print(f"[Vector Search] Querying {target_table} for: {q_preview}... (Limit: {limit})")
            embedding = get_embedding(q_str)
            if not embedding: return []
            query_vec = json.dumps(embedding)

        sql = f"""
            SELECT CONTENT_CHUNK, TEMPLATE_NAME, SHEET_NAME, SECTION_NAME,
                   VECTOR_DISTANCE(EMBEDDING, VECTOR(:v), COSINE) as distance
            FROM {target_table}
        """
        
        binds = {"v": query_vec}
        if section_name:
            sql += " WHERE SECTION_NAME = :s "
            binds["s"] = section_name
        elif not use_metadata_table:
            sql += " WHERE SECTION_NAME IN ('DB_METADATA', 'COLUMN_METADATA', 'TEMPLATE_LEVEL') "

        sql += " ORDER BY distance FETCH FIRST :l ROWS ONLY "
        binds["l"] = limit

        cursor = conn.cursor()
        cursor.execute(sql, binds)
        
        columns = [col[0] for col in cursor.description]
        rows = []
        for row in cursor.fetchall():
            res = dict(zip(columns, row))
            dist_val = res.get('DISTANCE') or res.get('distance') or 1.0
            sec = str(res.get('SECTION_NAME', ''))
            
            if use_metadata_table or sec == 'DB_METADATA':
                # In DB vectorization, SHEET_NAME stores the TABLE_NAME
                res['TABLE_NAME'] = str(res.get('SHEET_NAME') or '')
                
                # Extract COLUMN_NAME from CONTENT_CHUNK: "Column: NAME."
                chunk = str(res.get('CONTENT_CHUNK', ''))
                col_match = re.search(r'Column:\s*([A-Z0-9_]+)', chunk, re.IGNORECASE)
                res['COLUMN_NAME'] = col_match.group(1) if col_match else ''
            
            res['DISTANCE'] = float(dist_val)
            rows.append(res)
            
        print(f"[Vector Search] Found {len(rows)} relevant snippets from {target_table}")
        return rows
    except Exception as e:
        print(f"Vector Search Failed: {e}")
        return []

async def vector_search(query_text: str, top_k: int = 3):
    conn = None
    try:
        conn = get_db_connection()
        res = await search_vector_knowledge(conn, query_text=query_text, limit=top_k)
        return [{"template": r.get('TEMPLATE_NAME'), "sheet": r.get('SHEET_NAME'), "content": r.get('CONTENT_CHUNK')} for r in res]
    except: return []
    finally:
        if conn: conn.close()

# --- API Endpoints ---
@app.on_event("startup")
async def startup_event():
    initialize_pool()

@app.get("/api/assistant/health")
async def health():
    return {"status": "ok", "service": "Python Backend"}

@app.post("/api/fbdi/module-columns")
async def module_columns(req: ModuleColumnsRequest):
    conn = None
    print(f"[POST /api/module-columns] Called with module: {req.moduleName}")
    try:
        conn = get_db_connection()
        all_mappings: List[dict] = await get_filtered_mappings(conn, req.model_dump() if hasattr(req, 'model_dump') else req.dict())
        tables: List[str] = list(set([str(m.get('TABLE_NAME', '')) for m in all_mappings if isinstance(m, dict) and m.get('TABLE_NAME')]))
        print(f"[POST /api/module-columns] Found {len(tables)} tables")
        objects = []
        for tbl in tables:
            cursor = conn.cursor()
            cursor.execute("SELECT column_name, data_type FROM user_tab_columns WHERE table_name = UPPER(:tbl)", {"tbl": tbl})
            fields = [{"name": r[0], "type": map_oracle_type(r[1])} for r in cursor.fetchall()]
            objects.append({"id": tbl, "name": to_title_case(tbl), "tableName": tbl, "fields": fields})
        print(f"[POST /api/module-columns] Successfully mapped {len(objects)} objects")
        return {"success": True, "objects": objects}
    except Exception as e:
        print(f"[POST /api/module-columns] ERROR: {str(e)}")
        raise e
    finally:
        if conn: conn.close()

@app.post("/api/fbdi/fbdi-mappings")
async def fbdi_mappings(req: FbdiMappingsRequest):
    conn = None
    print(f"[POST /api/fbdi-mappings] Called with module: {req.moduleName}")
    try:
        conn = get_db_connection()
        mappings: List[dict] = await get_filtered_mappings(conn, req.model_dump() if hasattr(req, 'model_dump') else req.dict())
        print(f"[POST /api/fbdi-mappings] Successfully retrieved {len(mappings)} mappings")
        return {"success": True, "mappings": mappings}
    except Exception as e:
        print(f"[POST /api/fbdi-mappings] ERROR: {str(e)}")
        raise e
    finally:
        if conn: conn.close()

@app.get("/api/fbdi/modules")
async def get_modules():
    conn = None
    print("[GET /api/modules] Fetching list of modules")
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT DATA_GROUP FROM XX_INTELLI_RECON_TAB_COLUMN_MAPPING WHERE DATA_GROUP IS NOT NULL ORDER BY DATA_GROUP")
        res = [r[0] for r in cursor.fetchall()]
        print(f"[GET /api/modules] Found {len(res)} modules")
        return res
    except Exception as e:
        print(f"[GET /api/modules] ERROR: {str(e)}")
        raise e
    finally:
        if conn: conn.close()

@app.get("/api/tables")
async def get_tables():
    conn = None
    print("[GET /api/tables] Fetching list of MSAI tables")
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT table_name FROM user_tables WHERE table_name LIKE '%MSAI%' ORDER BY table_name")
        res = [r[0] for r in cursor.fetchall()]
        print(f"[GET /api/tables] Found {len(res)} tables")
        return {"success": True, "tables": res}
    except Exception as e:
        print(f"[GET /api/tables] ERROR: {str(e)}")
        raise e
    finally:
        if conn: conn.close()

@app.post("/api/fbdi/extract")
async def extract(req: ExtractionRequest):
    conn = None
    print(f"[POST /api/extract] Called with format: {req.exportFormat}")
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("BEGIN xxdm1.xx_dbms_session(1000); END;")
        except: pass
        
        query = await build_extraction_query(conn, req.columns, req.joins, req.filters, req.limit)
        print(f"[POST /api/extract] Executing query: {query}")
        cursor.execute(query)
        cols = [c[0] for c in cursor.description]
        rows = cursor.fetchall()
        data = [dict(zip(cols, r)) for r in rows]
        print(f"[POST /api/extract] Found {len(data)} rows")

        format_upper = (req.exportFormat or "").upper()
        if format_upper == 'FBDI':
            print("[POST /api/extract] Generating FBDI ZIP artifact")
            output = io.BytesIO()
            with zipfile.ZipFile(output, "w") as zf:
                csv_buf = io.StringIO()
                # Use a proper CSV writer to handle quotes and commas correctly
                writer = csv.writer(csv_buf, quoting=csv.QUOTE_MINIMAL)
                writer.writerow(cols)
                for d in data: 
                    writer.writerow([d.get(c) for c in cols])
                zf.writestr(f"{req.sheetName}.csv", csv_buf.getvalue())
            output.seek(0)
            return StreamingResponse(output, media_type="application/zip", headers={"Content-Disposition": f"attachment; filename={req.sheetName}.zip"})
        
        return {"success": True, "data": data}
    except Exception as e:
        print(f"[POST /api/extract] ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        return {"success": False, "message": str(e)}
    finally:
        if conn: conn.close()

@app.post("/api/fbdi/extract-batch")
async def extract_batch(req: BatchExtractionRequest):
    conn = None
    print(f"[POST /api/extract-batch] Called with format: {req.exportFormat}")
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("BEGIN xxdm1.xx_dbms_session(1000); END;")
        except: pass
        
        results = []
        for i, spec in enumerate(req.specs):
            print(f"[POST /api/extract-batch] Processing spec {i+1}/{len(req.specs)}: {spec.sheetName}")
            query = await build_extraction_query(conn, spec.columns, spec.joins, spec.filters)
            # Use same cursor
            cursor.execute(query)
            cols = [c[0] for c in cursor.description]
            results.append({"sheetName": spec.sheetName, "header_aliases": cols, "data": [dict(zip(cols, r)) for r in cursor.fetchall()]})
            print(f"[POST /api/extract-batch] Spec {spec.sheetName} returned {len(results[-1]['data'])} rows")

        format_upper = (req.exportFormat or "").upper()
        if format_upper == 'FBDI':
            print("[POST /api/extract-batch] Generating Consolidated FBDI ZIP artifact")
            output = io.BytesIO()
            with zipfile.ZipFile(output, "w") as zf:
                for res in results:
                    buf = io.StringIO()
                    writer = csv.writer(buf, quoting=csv.QUOTE_MINIMAL)
                    writer.writerow(res["header_aliases"])
                    for d in res["data"]: 
                        writer.writerow([d.get(c) for c in res["header_aliases"]])
                    zf.writestr(f"{res['sheetName']}.csv", buf.getvalue())
            output.seek(0)
            return StreamingResponse(output, media_type="application/zip", headers={"Content-Disposition": "attachment; filename=consolidated_extract.zip"})
        
        return {"success": True, "results": results}
    except Exception as e:
        print(f"[POST /api/extract-batch] ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        return {"success": False, "message": str(e)}
    finally:
        if conn: conn.close()

@app.post("/api/fbdi/save-model")
async def save_model(req: SaveModelRequest):
    conn = None
    print(f"[POST /api/save-model] Saving model: {req.modelName}")
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT MODEL_ID FROM XX_INTELLI_MODELS WHERE MODEL_NAME = :name", {"name": req.modelName})
        res = cursor.fetchone()
        if res: 
            model_id = res[0]
            print(f"[POST /api/save-model] Updating existing model ID: {model_id}")
        else:
            mid_var = cursor.var(oracledb.NUMBER)
            cursor.execute("INSERT INTO XX_INTELLI_MODELS (MODEL_NAME, USERNAME, USER_ID, TEMPLATENAME) VALUES (:n, :u, :uid, :t) RETURNING MODEL_ID INTO :mid", {"n": req.modelName, "u": req.username, "uid": req.userId, "t": req.templateName, "mid": mid_var})
            model_id = mid_var.getvalue()[0]
            print(f"[POST /api/save-model] Created new model ID: {model_id}")
        
        tables_csv = ", ".join([str(o.get('tableName') or o.get('name') or '') for o in req.objects if o.get('tableName') or o.get('name')])
        spec_names = ", ".join([str(s.get('name', '')) for s in req.specs])
        cursor.execute("DELETE FROM XX_INTELLI_MODEL_ARCHITECTURE WHERE MODEL_NAME = :n", {"n": req.modelName})
        cursor.execute("INSERT INTO XX_INTELLI_MODEL_ARCHITECTURE (MODEL_NAME, TABLES, EXTRACTIONS, TEMPLATENAME, RELATIONSHIPS) VALUES (:n, :t, :s, :tp, :r)", {"n": req.modelName, "t": tables_csv, "s": spec_names, "tp": req.templateName, "r": json.dumps(req.relationships)})
        print(f"[POST /api/save-model] Saved architecture and {len(req.specs)} specifications")
        
        for spec in req.specs:
            cursor.execute("SELECT MAX(VERSION) FROM XX_INTELLI_EXTRACTIONS WHERE MODEL_ID = :mid AND EXTRACTION_NAME = :en", {"mid": model_id, "en": spec['name']})
            v_res = cursor.fetchone()
            ver = "1.0"
            if v_res and v_res[0]: ver = f"{float(v_res[0]) + 0.1:.1f}"
            cursor.execute("INSERT INTO XX_INTELLI_EXTRACTIONS (MODEL_ID, EXTRACTION_NAME, COLUMN_MAPPINGS, EXTRACTION_SQL_QUERY, TEMPLATENAME, VERSION, DATA_FILTERS) VALUES (:mid, :en, :cm, :sql, :t, :v, :df)", {"mid": model_id, "en": spec['name'], "cm": json.dumps(spec.get('columns', [])), "sql": spec.get('sqlQuery', ''), "t": req.templateName, "v": ver, "df": json.dumps(spec.get('filters', []))})
        
        conn.commit()
        print(f"[POST /api/save-model] Successfully committed changes for {req.modelName}")
        return {"success": True, "modelId": model_id}
    except Exception as e:
        print(f"[POST /api/save-model] ERROR: {str(e)}")
        raise e
    finally:
        if conn: conn.close()

@app.get("/api/fbdi/saved-models")
async def saved_models():
    conn = None
    print("[GET /api/saved-models] Called")
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT MODEL_ID, MODEL_NAME, TEMPLATENAME, USERNAME, USER_ID FROM XX_INTELLI_MODELS ORDER BY MODEL_ID DESC")
        cols = [c[0] for c in cursor.description]
        models = [dict(zip(cols, r)) for r in cursor.fetchall()]
        print(f"[GET /api/saved-models] Found {len(models)} models")
        
        latest = None
        if models:
            latest_id = models[0].get('MODEL_ID') or models[0].get('model_id')
            print(f"[GET /api/saved-models] Loading detail for latest model ID: {latest_id}")
            latest = await get_saved_model_detail_internal(conn, str(latest_id))
            print("[GET /api/saved-models] Successfully loaded latest model detail")
            
        return {"success": True, "models": models, "latestModelDetail": latest}
    except Exception as e:
        print(f"[GET /api/saved-models] CRITICAL ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        raise e
    finally:
        if conn: conn.close()

@app.get("/api/fbdi/saved-model/{model_id}")
async def saved_model_detail(model_id: int):
    conn = None
    print(f"[GET /api/saved-model/{model_id}] Fetching detail")
    try:
        conn = get_db_connection()
        detail: dict = await get_saved_model_detail_internal(conn, str(model_id))
        print(f"[GET /api/saved-model/{model_id}] Successfully retrieved model detail")
        return {"success": True, **detail}
    except Exception as e:
        print(f"[GET /api/saved-model/{model_id}] ERROR: {str(e)}")
        raise e
    finally:
        if conn: conn.close()

@app.post("/api/fbdi/model/update-architecture")
async def update_architecture(req: UpdateArchitectureRequest):
    conn = None
    print(f"[POST /api/model/update-architecture] Updating architecture for {req.modelName}")
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        tables = ", ".join([o.get('tableName') or o.get('name') for o in req.objects if o.get('tableName') or o.get('name')])
        cursor.execute("DELETE FROM XX_INTELLI_MODEL_ARCHITECTURE WHERE MODEL_NAME = :n", {"n": req.modelName})
        cursor.execute("INSERT INTO XX_INTELLI_MODEL_ARCHITECTURE (MODEL_NAME, TABLES, RELATIONSHIPS, TEMPLATENAME) VALUES (:n, :t, :r, (SELECT MAX(TEMPLATENAME) FROM XX_INTELLI_MODELS WHERE MODEL_NAME = :n))", {"n": req.modelName, "t": tables, "r": json.dumps(req.relationships)})
        conn.commit()
        print(f"[POST /api/model/update-architecture] Successfully updated architecture for {req.modelName}")
        return {"success": True}
    except Exception as e:
        print(f"[POST /api/model/update-architecture] ERROR: {str(e)}")
        raise e
    finally:
        if conn: conn.close()

@app.post("/api/fbdi/extraction/update")
async def update_extraction(req: UpdateExtractionRequest):
    conn = None
    print(f"[POST /api/extraction/update] Updating extraction {req.extractionName} for model ID {req.modelId} (Clone: {req.isClone})")
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        if req.isClone:
            cursor.execute("SELECT MAX(VERSION) FROM XX_INTELLI_EXTRACTIONS WHERE MODEL_ID = :mid AND EXTRACTION_NAME = :en", {"mid": req.modelId, "en": req.extractionName})
            res = cursor.fetchone()
            ver = f"{float(res[0]) + 0.1:.1f}" if res and res[0] else "1.0"
            cursor.execute("INSERT INTO XX_INTELLI_EXTRACTIONS (MODEL_ID, EXTRACTION_NAME, COLUMN_MAPPINGS, EXTRACTION_SQL_QUERY, TEMPLATENAME, VERSION, DATA_FILTERS, SHEET_NAME) VALUES (:mid, :en, :m, :s, :t, :v, :f, :sn)", {"mid": req.modelId, "en": req.extractionName, "m": json.dumps(req.columns), "s": req.sqlQuery, "t": req.templateName, "v": ver, "f": json.dumps(req.filters), "sn": req.sheetName})
            action = "CLONE"
        else:
            ver = req.version or "1.0"
            cursor.execute("UPDATE XX_INTELLI_EXTRACTIONS SET COLUMN_MAPPINGS = :m, EXTRACTION_SQL_QUERY = :s, TEMPLATENAME = :t, DATA_FILTERS = :f, SHEET_NAME = :sn WHERE MODEL_ID = :mid AND EXTRACTION_NAME = :en AND VERSION = :v", {"m": json.dumps(req.columns), "s": req.sqlQuery, "t": req.templateName, "f": json.dumps(req.filters), "sn": req.sheetName, "mid": req.modelId, "en": req.extractionName, "v": ver})
            if cursor.rowcount == 0:
                print(f"[POST /api/extraction/update] Version {ver} not found, inserting as 1.0")
                cursor.execute("INSERT INTO XX_INTELLI_EXTRACTIONS (MODEL_ID, EXTRACTION_NAME, COLUMN_MAPPINGS, EXTRACTION_SQL_QUERY, TEMPLATENAME, VERSION, DATA_FILTERS, SHEET_NAME) VALUES (:mid, :en, :m, :s, :t, '1.0', :f, :sn)", {"mid": req.modelId, "en": req.extractionName, "m": json.dumps(req.columns), "s": req.sqlQuery, "t": req.templateName, "f": json.dumps(req.filters), "sn": req.sheetName})
            action = "SAVE"
        conn.commit()
        print(f"[POST /api/extraction/update] Successfully {action}d extraction version {ver}")
        return {"success": True, "version": ver, "action": action}
    except Exception as e:
        print(f"[POST /api/extraction/update] ERROR: {str(e)}")
        raise e
    finally:
        if conn: conn.close()

@app.post("/api/fbdi/upload-template")
async def upload_template(template: UploadFile = File(...)):
    print(f"[POST /api/upload-template] Receiving file: {template.filename}")
    name = f"{int(datetime.now().timestamp())}-{template.filename}"
    path = os.path.join("templates", name)
    os.makedirs("templates", exist_ok=True)
    with open(path, "wb") as buffer:
        shutil.copyfileobj(template.file, buffer)
    print(f"[POST /api/upload-template] Saved template to: {path}")
    return {"success": True, "filename": name}

@app.post("/api/fbdi/generate-sql")
async def generate_sql(req: GenerateSqlRequest):
    conn = None
    print("[POST /api/generate-sql] Generating preview SQL")
    try:
        conn = get_db_connection()
        query: str = await build_extraction_query(conn, req.columns, req.joins, req.filters, req.limit)
        q_preview = query[:100] if query else ''
        print(f"[POST /api/generate-sql] Generated SQL: {q_preview}...")
        return {"success": True, "query": query}
    except Exception as e:
        print(f"[POST /api/generate-sql] ERROR: {str(e)}")
        raise e
    finally:
        if conn: conn.close()

@app.get("/api/db-check")
async def db_check():
    conn = None
    print("[GET /api/db-check] Performing connectivity test")
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT sysdate FROM DUAL")
        res = cursor.fetchone()[0]
        print(f"[GET /api/db-check] Connection OK: {res}")
        return {"status": "connected", "database": "oracle", "result": res}
    except Exception as e:
        print(f"[GET /api/db-check] Connection FAILED: {str(e)}")
        return {"status": "error", "message": str(e)}
    finally:
        if conn: conn.close()

@app.post("/api/fbdi/analyze-fbdi")
async def analyze_fbdi(req: Request):
    metadata = await req.json()
    print(f"[POST /api/analyze-fbdi] Analyzing template: {metadata.get('fileName')}")
    try:
        analysis: dict = await analyze_fbdi_with_oci(metadata)
        print(f"[POST /api/analyze-fbdi] Analysis complete for {analysis.get('moduleName')}")
        return {"success": True, "analysis": analysis}
    except Exception as e:
        print(f"[POST /api/analyze-fbdi] ERROR: {str(e)}")
        raise e

@app.post("/api/fbdi/smart-map")
async def smart_map(req: Request):
    data = await req.json()
    print(f"[POST /api/smart-map] Mapping {len(data.get('headers', []))} headers to {len(data.get('candidates', []))} candidates")
    try:
        mappings: list = await smart_map_columns_with_oci(data.get('headers') or [], data.get('candidates') or [], data.get('moduleContext') or '')
        print(f"[POST /api/smart-map] Successfully generated {len(mappings)} mappings")
        return {"success": True, "mappings": mappings}
    except Exception as e:
        print(f"[POST /api/smart-map] ERROR: {str(e)}")
        raise e

@app.post("/api/fbdi/nl-query")
async def nl_query(req: Request):
    data = await req.json()
    query = data.get('query')
    print(f"[POST /api/nl-query] Processing natural language query: {query}")
    try:
        vec_res: list = await vector_search(str(query or ''))
        if vec_res:
            print(f"[POST /api/nl-query] Found {len(vec_res)} vector matches, answering via RAG")
            knowledge = "\n".join([r['content'] for r in vec_res])
            prompt = f"Help with: {query}. Knowledge: {knowledge}"
            client = get_oci_genai_client()
            chat_details = oci.generative_ai_inference.models.ChatDetails(
                compartment_id=COMPARTMENT_ID,
                serving_mode=oci.generative_ai_inference.models.OnDemandServingMode(model_id=CHAT_MODEL_ID),
                chat_request=oci.generative_ai_inference.models.CohereChatRequest(message=prompt, max_tokens=600)
            )
            res = client.chat(chat_details)
            ans = res.data.chat_result.chat_response.text
            print("[POST /api/nl-query] Successfully generated RAG response")
            return {"success": True, "answer": ans}
        
        print("[POST /api/nl-query] No vector matches, classifying intent via LLM")
        intent: dict = await process_nl_query_with_oci(str(query or ''), data.get('metadata') or {})
        print(f"[POST /api/nl-query] Intent processed: {intent.get('objectGroupId')}")
        return {"success": True, "intent": intent}
    except Exception as e:
        print(f"[POST /api/nl-query] ERROR: {str(e)}")
        raise e

async def suggest_transformations_with_oci(column_name: str, source_field: str, data_type: str, module_context: str):
    try:
        client = get_oci_genai_client()
        prompt = f"""You are a data transformation expert.
        Suggest the most relevant data transformations for the following field:
        - Column Header: "{column_name}"
        - Source Field: "{source_field}"
        - Data Type: "{data_type}"
        - Module Context: "{module_context}"

        Available Transformation Types:
        - UPPERCASE (String only)
        - LOWERCASE (String only)
        - TRIM (String only)
        - AI_SUMMARY (String only)
        - DATE_FORMAT (Date only - Requires "format" parameter like 'YYYY/MM/DD' or 'DD-MON-YYYY')
        - REGEX_REPLACE (String only - Requires "pattern" and "replace")
        - LOOKUP (Reference data)
        - AGGREGATE_SUM (Number only)
        - CONDITIONAL_LOGIC (Any)
        - PHONE_FORMAT (String)
        - MASK_DATA (String - e.g. 'X-XXX-XXX')
        - SUBSTRING (String - Requires "start" and "length")
        - COALESCE (Any - Falls back to a value if null)
        - MULTIPLY (Number - Requires "factor")
        - MAP_VALUE (Any - Simple replacement mapping)

        CRITICAL RULES:
        1. If the Data Type is "NUMBER", DO NOT suggest UPPERCASE, LOWERCASE, TRIM, or AI_SUMMARY.
        2. If the Data Type is "DATE", always suggest DATE_FORMAT. **You MUST provide a likely format string in the params (e.g., 'YYYY/MM/DD' or 'DD-MON-YYYY' based on Oracle/Fusion standards).**
        3. For REGEX_REPLACE, provide likely pattern/replace params if obvious.
        4. For MULTIPLY, if it's a currency or unit field, suggest a factor if relevant.

        Output ONLY a JSON array of transformation objects:
        [
          {{ "type": "TYPE1", "params": {{ "key": "value" }} }},
          {{ "type": "DATE_FORMAT", "params": {{ "format": "YYYY/MM/DD" }} }}
        ]"""

        chat_details = oci.generative_ai_inference.models.ChatDetails(
            compartment_id=COMPARTMENT_ID,
            serving_mode=oci.generative_ai_inference.models.OnDemandServingMode(model_id=CHAT_MODEL_ID),
            chat_request=oci.generative_ai_inference.models.CohereChatRequest(
                message=prompt, 
                max_tokens=600, 
                temperature=0.1
            )
        )
        response = client.chat(chat_details)
        text = response.data.chat_result.chat_response.text
        
        clean_text = re.sub(r'```json\s*|\s*```', '', text).strip()
        json_match = re.search(r'\[.*\]', clean_text, re.DOTALL)
        return json.loads(json_match.group(0)) if json_match else []
    except Exception as e:
        print(f"Suggest Transformations Failed: {e}")
        return []

# --- More API Endpoints ---
@app.post("/api/fbdi/suggest-transformations")
async def suggest_transformations_api(req: Request):
    data = await req.json()
    res = await suggest_transformations_with_oci(
        data.get('columnName'),
        data.get('sourceField'),
        data.get('dataType'),
        data.get('moduleContext')
    )
    return res

async def process_assistant_chat(message: str):
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Fetch current models for context
        cursor.execute("SELECT MODEL_NAME, MODEL_ID FROM XX_INTELLI_MODELS FETCH FIRST 10 ROWS ONLY")
        models = [{"name": r[0], "id": r[1]} for r in cursor.fetchall()]
        
        model_context = "Available Data Models: " + ", ".join([f"{m['name']} (ID: {m['id']})" for m in models])
        
        system_prompt = f"""You are the FBDI Assistant, an expert in Oracle Fusion Data Migration.
        {model_context}
        
        Your goal is to help users with:
        1. Navigating their existing models.
        2. Understanding FBDI templates.
        3. General Oracle technical advice.
        
        If a user asks to see or open a model that exists in the context, respond with text AND include a 'NAVIGATE' action.
        
        Output format MUST be JSON:
        {{
          "reply": "Your conversational response here",
          "action_required": true/false,
          "action_type": "NAVIGATE" or null,
          "metadata": {{ "url": "/models/123" }} or null,
          "options": [{{ "label": "Open Model", "value": "nav", "url": "/models/123" }}] or null
        }}"""

        client = get_oci_genai_client()
        chat_details = oci.generative_ai_inference.models.ChatDetails(
            compartment_id=COMPARTMENT_ID,
            serving_mode=oci.generative_ai_inference.models.OnDemandServingMode(model_id=CHAT_MODEL_ID),
            chat_request=oci.generative_ai_inference.models.CohereChatRequest(
                message=f"{system_prompt}\n\nUser: {message}",
                max_tokens=800,
                temperature=0.3
            )
        )
        response = client.chat(chat_details)
        text = response.data.chat_result.chat_response.text
        
        # Clean up JSON from LLM
        clean_text = re.sub(r'```json\s*|\s*```', '', text).strip()
        json_match = re.search(r'\{.*\}', clean_text, re.DOTALL)
        if json_match:
            return json.loads(json_match.group(0))
        else:
            return {"reply": text, "action_required": False}

    except Exception as e:
        print(f"Assistant Chat Error: {e}")
        return {"reply": f"I'm sorry, I encountered an error: {str(e)}", "action_required": False}
    finally:
        if conn: conn.close()

@app.post("/api/assistant/chat")
async def assistant_chat_api(req: Request):
    data = await req.json()
    message = data.get('message')
    print(f"[Assistant] Chatting: {message[:50]}...")
    result = await process_assistant_chat(message)
    return result

@app.post("/api/fbdi/discovery/bottom-up-discovery")
async def bottom_up_discovery(req: Request):
    conn = None
    try:
        data = await req.json()
        headers = data.get('headers', [])
        sheet_name = data.get('sheetName')
        module_name = data.get('moduleName')
        intent = data.get('intent')
        header_infos = data.get('headerInfos', [])

        conn = get_db_connection()
        
        # 1. Generate Header Personas for Vector Search
        query_personas = []
        for i, h in enumerate(headers):
            info = header_infos[i] if i < len(header_infos) else ''
            persona = f"Header: {h}. Context: {info}. Target Module: {module_name or ''}"
            query_personas.append(persona)

        print(f"[Bottom-Up Discovery] Generating batch embeddings for {len(query_personas)} headers...")
        embeddings = []
        for p in query_personas:
            emb = get_embedding(p)
            if emb: embeddings.append(emb)

        if not embeddings or len(embeddings) < len(headers):
            raise Exception(f"Failed to generate embeddings for sheet: {sheet_name}")

        candidate_tables = set()
        discoveries = []

        for i, header in enumerate(headers):
            raw_matches: List[dict] = await search_vector_knowledge(conn, limit=10, use_metadata_table=True, pre_generated_embedding=embeddings[i])
            
            info_str: str = str(header_infos[i]) if i < len(header_infos) else ''
            h_clean = str(header).replace('*', '').replace(' ', '').strip().upper()

            internal_name = ''
            internal_match = re.search(r'(?:Internal Column|Column Name):\s*([A-Z0-9_]+)', info_str, re.IGNORECASE)
            if internal_match: internal_name = internal_match.group(1).strip().upper()

            table_hint = ''
            table_match = re.search(r'Associated Table: ([^|]+)', info_str, re.IGNORECASE)
            if table_match: table_hint = table_match.group(1).strip().upper()

            module_hint = (module_name or '').upper()

            re_ranked: List[dict] = []
            for m in raw_matches:
                boost = 0.0
                has_name_match = False
                col_name = str(m.get('COLUMN_NAME', '')).upper().replace('_', '')
                tab_name = str(m.get('TABLE_NAME', '')).upper()
                content = str(m.get('CONTENT_CHUNK', '')).upper()

                expanded_h = get_expanded_terms(h_clean)
                is_technical_match = (internal_name and col_name == internal_name.replace('_', '')) or any(term.replace('_', '') == col_name for term in expanded_h)
                is_partial_match = any(term.replace('_', '') in col_name or col_name in term.replace('_', '') for term in expanded_h) or (internal_name and (internal_name.replace('_', '') in col_name or col_name in internal_name.replace('_', '')))

                # Rules
                if is_technical_match:
                    boost += 0.50
                    has_name_match = True
                elif is_partial_match:
                    boost += 0.15
                    has_name_match = True

                # Attribute Guard
                h_digits_match = re.search(r'\d+$', h_clean)
                col_digits_match = re.search(r'\d+$', col_name)
                if h_digits_match or col_digits_match:
                    h_digits = h_digits_match.group(0) if h_digits_match else None
                    col_digits = col_digits_match.group(0) if col_digits_match else None
                    if h_digits != col_digits and ('ATTRIBUTE' in h_clean or 'ATTRIBUTE' in col_name):
                        boost -= 0.70

                if h_clean.startswith('ATTRIBUTE') and col_name.startswith('ATTRIBUTE'):
                    boost += 0.10
                elif h_clean.startswith('ATTRIBUTE') and not col_name.startswith('ATTRIBUTE'):
                    boost -= 0.10

                is_global_header = 'GLOBAL' in h_clean or (internal_name and 'GLOBAL' in internal_name)
                is_global_column = 'GLOBAL' in col_name
                if is_global_header != is_global_column and ('ATTRIBUTE' in h_clean or 'ATTRIBUTE' in col_name):
                    boost -= 0.60

                is_ts_header = 'TIMESTAMP' in h_clean or (internal_name and 'TIMESTAMP' in internal_name)
                is_ts_column = 'TIMESTAMP' in col_name
                if is_ts_header != is_ts_column and ('ATTRIBUTE' in h_clean or 'ATTRIBUTE' in col_name):
                    boost -= 0.60

                if table_hint and tab_name == table_hint:
                    boost += 0.40

                if module_hint and module_hint not in ['UNKNOWN', 'N/A']:
                    keywords = [module_hint]
                    if 'SUPPLIER' in module_hint:
                        keywords.extend(['POZ', 'SUPPLIER', 'VENDOR'])
                        if tab_name.startswith('POZ_'): boost += 0.25
                    if any(k in module_hint for k in ['PROCUREMENT', 'PURCHASING', 'ORDER']):
                        keywords.extend(['PO', 'PURCHASE', 'ORDER'])
                        if tab_name.startswith('PO_'): boost += 0.25
                    if any(k in module_hint for k in ['PAYABLES', 'INVOICE']):
                        keywords.extend(['AP', 'INVOICE', 'PAYABLE'])
                        if tab_name.startswith('AP_'): boost += 0.25
                    
                    if any(k in content or k in tab_name for k in keywords):
                        boost += 0.12

                if tab_name.startswith('XXEA_MS_'): boost += 0.05

                dist = m.get('DISTANCE', 1.0)
                final_distance = dist - boost
                if not has_name_match and dist > 0.45:
                    final_distance = 1.0
                
                m['distance'] = max(0.0, float(final_distance))
                m['originalDistance'] = dist
                m['tableName'] = m.get('TABLE_NAME')
                m['columnName'] = m.get('COLUMN_NAME')
                re_ranked.append(m)

            re_ranked = [r for r in re_ranked if r['distance'] < 0.65]
            re_ranked.sort(key=lambda x: x['distance'])
            
            top_matches = re_ranked[:5]
            for tm in top_matches:
                if tm.get('tableName'): candidate_tables.add(tm['tableName'])

            discoveries.append({
                "header": header,
                "idx": i,
                "matches": top_matches
            })

        # 2. AI Table Ranking
        print(f"[Bottom-Up Discovery] Ranking candidate tables by AI intent...")
        tables_for_ranking = [{"tableName": t, "comments": ""} for t in list(candidate_tables)]
        ai_ranked_tables = []
        try:
            ai_ranked_tables = await rank_tables_with_oci(intent or sheet_name, tables_for_ranking, {"moduleName": module_name, "sheetNames": [sheet_name]})
        except Exception as e:
            print(f"AI Table Ranking failed: {e}")

        return {
            "success": True,
            "sheetName": sheet_name,
            "discoveries": discoveries,
            "candidateTables": list(candidate_tables),
            "aiRankedTables": ai_ranked_tables,
            "relationships": []
        }

    except Exception as e:
        print(f"Bottom-Up Discovery Failed: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "message": str(e)}
    finally:
        if conn: conn.close()

if __name__ == "__main__":
    # Changing port to 3006 as per user request to replace Node.js service
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3006)
