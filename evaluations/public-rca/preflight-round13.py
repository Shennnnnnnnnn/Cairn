"""No inference or implementation copy: validate fixed controls and HTTP parsing."""
import ast
import json
import re
from pathlib import Path

base=Path(__file__).resolve().parent
old=json.loads((base/'runs/2026-10-18-scheduler-three-model-round12-final/manifest.json').read_text())
schedule=[]
for index,model in enumerate(['deepseek','glm','sol']):
    for repeat in range(1,4):
        for ci in range(3):
            case=['new-01','new-02','new-03'][(ci+repeat+index-1)%3]
            for arm in ['native','cairn'] if (ci+repeat+index)%2 else ['cairn','native']:
                schedule.append({'id':f'{model}-{case}-r{repeat}-{arm}','model':model,'case':case,'repeat':repeat,'arm':arm,'kind':'rca'})
assert schedule==old['schedule'] and len(schedule)==54
source=ast.parse((base/'analyze-round13.py').read_text())
function=next(node for node in source.body if isinstance(node,ast.FunctionDef) and node.name=='http_status')
namespace={'json':json,'re':re}
exec(compile(ast.Module(body=[function],type_ignores=[]),'<http-status-function>','exec'),namespace)
cases=[('502 {"status":502,"instance":"a4c4015e7dda302a"}',502),('502 {"status":502,"ray_id":"a4c403c71cac2689"}',502),('503: {"message":"Service temporarily unavailable; request401"}',503),('401: Unauthorized',401),('403 Forbidden',403),('429: rate limit',429),('{"status":502,"instance":"403"}',502),('trace id contains401butnostatus',None),({'response':{'status':403}},403)]
for value,expected in cases:assert namespace['http_status'](value)==expected,(value,expected)
print(json.dumps({'scheduleMatchesRound12':True,'actors':54,'modelIndices':{'deepseek':0,'glm':1,'sol':2},'httpStatusRegressionCases':len(cases),'paidModelCalls':0,'implementationCopied':False,'runRootExists':(base/'runs/2026-10-18-scheduler-contract-round13-final').exists()}))
