import json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
import pandas as pd
import numpy as np

# Contacts
with open('C:/Users/בונים ומוגנים/OneDrive/שולחן העבודה/קלוד/contacts_data.json', 'r', encoding='utf-8') as f:
    contacts = json.load(f)

# Tables 1 & 2
df = pd.read_excel('C:/Users/בונים ומוגנים/OneDrive/מסמכים/חוברת1.xlsx', header=None, sheet_name=0)
table1 = [str(v).strip() for v in df.iloc[1:, 2] if str(v).strip() not in ['nan','NaN','']]
table2 = [str(v).strip() for v in df.iloc[1:, 6] if str(v).strip() not in ['nan','NaN','']]

# Vows & Payments
with open('C:/Users/בונים ומוגנים/OneDrive/שולחן העבודה/קלוד/vows_data.json', 'r', encoding='utf-8') as f:
    vows = json.load(f)
with open('C:/Users/בונים ומוגנים/OneDrive/שולחן העבודה/קלוד/payments_data.json', 'r', encoding='utf-8') as f:
    payments = json.load(f)

template = open('C:/Users/בונים ומוגנים/OneDrive/שולחן העבודה/קלוד/crm_template.html', 'r', encoding='utf-8').read()

out = template.replace('/*CONTACTS_DATA*/', 'const CONTACTS_DATA = ' + json.dumps(contacts, ensure_ascii=False) + ';')
out = out.replace('/*TABLE1_DATA*/', 'const TABLE1 = ' + json.dumps(table1, ensure_ascii=False) + ';')
out = out.replace('/*TABLE2_DATA*/', 'const TABLE2 = ' + json.dumps(table2, ensure_ascii=False) + ';')
out = out.replace('/*VOWS_DATA*/', 'const VOWS_DATA = ' + json.dumps(vows, ensure_ascii=False) + ';')
out = out.replace('/*PAYMENTS_DATA*/', 'const PAYMENTS_DATA = ' + json.dumps(payments, ensure_ascii=False) + ';')

with open('C:/Users/בונים ומוגנים/OneDrive/שולחן העבודה/קלוד/CRM_בית_כנסת.html', 'w', encoding='utf-8') as f:
    f.write(out)

print('Done! Contacts:', len(contacts), '| Vows:', len(vows), '| Payments:', len(payments), '| Size:', len(out))
