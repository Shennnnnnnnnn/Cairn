"""Actual Python Cairn server, dispatcher, contracts and prompts; native transport only.

The source archive is never edited. Adaptations: private in-process HTTP transport,
private graph files/workspace, the common Pi runner, and disabled phase deadlines.
"""
import inspect,json,logging,sys,threading,time,signal
from pathlib import Path

cfg=json.loads(Path(sys.argv[1]).read_text())
sys.path.insert(0,cfg['originalSource'])
from fastapi.testclient import TestClient
from cairn.server import db
from cairn.server.app import app
from cairn.dispatcher.scheduler import loop as scheduler_module
from cairn.dispatcher.protocol.client import CairnClient
from cairn.dispatcher.runtime.local_backend import LocalBackend
from cairn.dispatcher.runtime.local_process import LocalProcess
from cairn.dispatcher.tasks import common
from cairn.dispatcher.workers.adapters.pi import PiDriver
from cairn.dispatcher.workers.base import DriverResult
from cairn.dispatcher.workers.registry import LOCAL_DRIVERS

directory=Path(cfg['dir']);work=Path(cfg['work']);directory.mkdir(parents=True,exist_ok=True)
logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(name)s %(message)s',handlers=[logging.FileHandler(directory/'original.dispatch.log')])
save=lambda p,x:Path(p).write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
db.DEFAULT_DB=directory/'original.db'
common.GRAPH_SNAPSHOT_ROOT=str(work/'.cairn/original-context')
old_communicate_timeout=common.communicate_timeout
common.communicate_timeout=lambda timeout_seconds,*a,**kw:None if timeout_seconds is None else old_communicate_timeout(timeout_seconds,*a,**kw)

class Completed(Exception):pass

class BridgeDriver(PiDriver):
    def __init__(self):
        super().__init__(local=True);self.number=0;self.lock=threading.Lock()
    def command(self,prompt,session,phase):
        with self.lock:self.number+=1;number=self.number
        phase_dir=directory/'phases'/f'phase-{number:03d}-{phase}';phase_dir.mkdir(parents=True)
        payload={**cfg,'phase':phase,'number':number,'phaseDir':str(phase_dir),'prompt':prompt,'resumeId':session}
        request=phase_dir/'original.request.json';save(request,payload)
        return [cfg['node'],cfg['bridge'],str(request)]
    def build_execute(self,worker,prompt,session):
        caller=next((frame.function for frame in inspect.stack() if frame.function in {'run_bootstrap_task','run_reason_task','run_explore_task'}),'unknown')
        phase={'run_bootstrap_task':'bootstrap','run_reason_task':'reason','run_explore_task':'explore'}.get(caller,'unknown')
        return DriverResult(argv=self.command(prompt,session,phase),session=session)
    def build_conclude(self,worker,prompt,session):return self.command(prompt,session,'conclude')

class NoBudgetProcess(LocalProcess):
    def communicate(self,timeout):return super().communicate(None)

class PrivateBackend(LocalBackend):
    def _project_dir(self,project_id):return work
    def build_exec_process(self,container_name,env,command,timeout_seconds=None,kill_after_seconds=5):
        return NoBudgetProcess(command,cwd=container_name,env={**__import__('os').environ,**env},timeout_seconds=None,term_grace_seconds=kill_after_seconds)

with TestClient(app) as http:
    class PrivateClient(CairnClient):
        def _session(self):return http
        def list_projects(self):
            rows=super().list_projects()
            if rows and all(row.status=='completed' for row in rows):raise Completed()
            return rows
    scheduler_module.CairnClient=PrivateClient
    LOCAL_DRIVERS['pi']=BridgeDriver()
    created=http.post('/projects',json={'title':'Independent benchmark task','origin':'TASK.md and original files in the assigned workspace; input opinions are unverified material.','goal':cfg['prompt'],'bootstrap_enabled':True})
    created.raise_for_status();project_id=created.json()['project']['id']
    settings={'server':'http://testserver','runtime':{'execution':'local','worker_healthcheck':'disabled','max_workers':1,'max_running_projects':1,'max_project_workers':1,'interval':1,'healthcheck_timeout':15,'prompt_group':'default'},'tasks':{'bootstrap':{'timeout':1,'conclude_timeout':1},'reason':{'timeout':1,'max_intents':3},'explore':{'timeout':1,'conclude_timeout':1}},'local':{'workspace_root':str(work.parent),'completed_action':'keep'},'workers':[{'name':'round15-pi','type':'pi','task_types':['bootstrap','reason','explore'],'max_running':1,'priority':0}]}
    # JSON is a YAML subset; validated by the original DispatchConfig.load.
    config_file=directory/'original.dispatch.json';save(config_file,settings)
    loop=scheduler_module.DispatcherLoop(config_file)
    for task in [loop.config.tasks.bootstrap,loop.config.tasks.reason,loop.config.tasks.explore]:
        task.timeout=None
        if hasattr(task,'conclude_timeout'):task.conclude_timeout=None
    loop.container_manager=PrivateBackend(loop.config.local)
    # Probe only local executable availability without any inference request.
    loop._startup_healthchecks_checked=True
    save(directory/'original.adaptation.json',{'sourceEdited':False,'server':'Actual FastAPI routes over TestClient; thread-safe private HTTP transport','dispatcher':'Actual DispatcherLoop.run including selection, leases, reaping and graph triggers','modelExecution':'Same frozen runPi as every other arm, isolated config and common flags','phaseTimeouts':None,'tokenBudget':None,'roundBudget':None,'concurrency':1,'sourceRoot':cfg['originalSource'],'projectId':project_id,'workspace':str(work),'graphRoot':common.GRAPH_SNAPSHOT_ROOT,'fixture':cfg.get('fixture',False),'startupCLIProbeSkipped':'The shared native runner has a frozen absolute CLI path; no model health probe'})
    def stop(signum,frame):
        for running in list(loop.futures.values()):running.cancellation.cancel('User cancelled benchmark')
        raise KeyboardInterrupt('User cancelled benchmark')
    signal.signal(signal.SIGTERM,stop)
    signal.signal(signal.SIGINT,stop)
    start=time.monotonic();error=None
    try:loop.run()
    except Completed:pass
    except BaseException as exc:error=f'{type(exc).__name__}: {exc}'
    final=http.get(f'/projects/{project_id}');final.raise_for_status()
    save(directory/'original.project.json',final.json())
    exported=http.get(f'/projects/{project_id}/export',params={'format':'yaml'});exported.raise_for_status();(directory/'original.graph.yaml').write_text(exported.text)
    save(directory/'original.terminal.json',{'status':final.json()['project']['status'],'error':error,'wallSeconds':time.monotonic()-start,'finishedAt':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat()})
    if error:raise RuntimeError(error)
