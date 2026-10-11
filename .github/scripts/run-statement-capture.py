"""One exact annual-history capture. Capture evidence is never financial admission."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.abc
import importlib.machinery
import importlib.metadata
import importlib.util
import json
import logging
import os
from pathlib import Path, PurePosixPath
import re
import platform
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from types import MappingProxyType, SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
BUNDLE = ROOT / '.github/financial-statement-capture'
# Direct .py CLI entry is compiled by the trusted interpreter, not imported from
# pycache. Install before app/provider imports; stdlib and other inherited third-
# party dependencies remain trusted, outside this protected import proof.
def _guard_require(condition, message):
    if not condition:
        raise ImportError('Protected capture import: ' + message)


def _guard_read(path, digest=None):
    """Open each path component without symlinks; hash the exact bytes read."""
    path = Path(path)
    _guard_require(path.is_absolute() and '..' not in path.parts, 'unsafe path')
    directory = os.open(path.anchor, os.O_RDONLY | os.O_DIRECTORY)
    try:
        for component in path.parts[1:-1]:
            child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
        descriptor = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
        with os.fdopen(descriptor, 'rb') as stream:
            before = os.fstat(stream.fileno())
            _guard_require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1,
                           'source/native/control must be regular and single-link')
            content = stream.read()
            after = os.fstat(stream.fileno())
        _guard_require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns,
                        before.st_ctime_ns) == (after.st_dev, after.st_ino, after.st_size,
                        after.st_mtime_ns, after.st_ctime_ns), 'file changed while reading')
    finally:
        os.close(directory)
    if digest is not None:
        _guard_require(re.fullmatch('[a-f0-9]{64}', digest) is not None
                       and hashlib.sha256(content).hexdigest() == digest,
                       'bytes changed: ' + str(path))
    return content


def _guard_pairs(pairs):
    value = {}
    for key, item in pairs:
        _guard_require(key not in value, 'duplicate control key')
        value[key] = item
    return value


def _guard_member(root, relative):
    member = PurePosixPath(relative)
    _guard_require(isinstance(relative, str) and not member.is_absolute()
                   and '..' not in member.parts and '\\' not in relative
                   and str(member) == relative, 'unsafe inventory member')
    return root.joinpath(*member.parts)


class HashBoundSourceLoader(importlib.machinery.SourceFileLoader):
    def __init__(self, name, path, digest, guard):
        super().__init__(name, str(path))
        self._digest, self._guard = digest, guard

    def get_code(self, fullname):
        _guard_require(fullname == self.name, 'loader name changed')
        # Never call SourceFileLoader.get_code: it accepts valid cached bytecode.
        return compile(_guard_read(Path(self.path), self._digest), self.path,
                       'exec', dont_inherit=True, optimize=0)

    def exec_module(self, module):
        self._guard._begin(self.name)
        try:
            super().exec_module(module)
            self._guard._record(self.name, module, self)
        except BaseException:
            self._guard._failed = True
            raise


class HashBoundExtensionLoader(importlib.machinery.ExtensionFileLoader):
    def __init__(self, name, path, digest, guard):
        super().__init__(name, str(path))
        self._digest, self._guard = digest, guard

    def create_module(self, spec):
        self._guard._begin(self.name)
        # Extension initialization can run in create_module, before exec_module.
        _guard_read(Path(self.path), self._digest)
        try:
            return super().create_module(spec)
        except BaseException:
            self._guard._failed = True
            raise

    def exec_module(self, module):
        _guard_read(Path(self.path), self._digest)
        try:
            super().exec_module(module)
            self._guard._record(self.name, module, self)
        except BaseException:
            self._guard._failed = True
            raise


class CaptureSourceGuard(importlib.abc.MetaPathFinder):
    PROTECTED = frozenset(('app', 'yfinance', 'curl_cffi', 'certifi', 'cffi', '_cffi_backend'))

    def __init__(self, bindings, aliases=None):
        # Values: (absolute path, reviewed SHA256, is_package). No providers load.
        self.bindings = MappingProxyType(dict(bindings))
        self.aliases = MappingProxyType(dict(aliases or {}))
        self._ledger = ()  # Append-only immutable identity records; reload forbidden.
        self._native_exports = ()
        self._started = set()
        self._failed = False
        _guard_require(not any(self.protected(name) for name in sys.modules),
                       'protected module was already loaded')

    def protected(self, name):
        return name.split('.', 1)[0] in self.PROTECTED or name in self.aliases

    def _begin(self, name):
        _guard_require(not self._failed and name not in self._started,
                       'replayed or failed import: ' + name)
        self._started.add(name)

    def _record(self, name, module, loader):
        spec = module.__spec__
        package_paths = tuple(spec.submodule_search_locations or ())
        _guard_require(sys.modules.get(name) is module and module.__loader__ is loader
                       and spec.loader is loader, 'module identity changed during import')
        self._ledger += ((name, module, spec, loader, spec.origin, package_paths),)
        if name == 'curl_cffi._wrapper':
            # This exact pinned CFFI extension registers a Lib object rather than
            # a Python source module. Bind only its known in-memory export to
            # its already verified native owner, never a generic loader bypass.
            export_name = 'curl_cffi._wrapper.lib'
            export = getattr(module,'lib',None)
            _guard_require(isinstance(loader,HashBoundExtensionLoader)
                           and type(export).__module__ == '_cffi_backend'
                           and type(export).__name__ == 'Lib'
                           and sys.modules.get(export_name) is export,
                           'unexpected pinned native export')
            self._native_exports += ((export_name,export,module),)

    def _spec(self, name, resolved, binding):
        expected, digest, package = binding
        _guard_require(resolved is not None and resolved.origin == str(expected)
                       and resolved.has_location, 'unbound or alternate origin: ' + name)
        expected_paths = (str(expected.parent),) if package else ()
        _guard_require(tuple(resolved.submodule_search_locations or ()) == expected_paths,
                       'unbound package search locations: ' + name)
        if expected.suffix == '.py':
            _guard_require(type(resolved.loader) is importlib.machinery.SourceFileLoader,
                           'sourceless or nonstandard source loader: ' + name)
            loader = HashBoundSourceLoader(name, expected, digest, self)
        else:
            _guard_require(type(resolved.loader) is importlib.machinery.ExtensionFileLoader
                           and any(str(expected).endswith(s) for s in importlib.machinery.EXTENSION_SUFFIXES),
                           'unbound native loader: ' + name)
            loader = HashBoundExtensionLoader(name, expected, digest, self)
        return importlib.util.spec_from_file_location(name, expected, loader=loader,
                    submodule_search_locations=list(expected_paths) if package else None)

    def find_spec(self, fullname, path=None, target=None):
        if not self.protected(fullname):
            return None
        _guard_require(target is None and fullname in self.bindings and fullname not in self.aliases,
                       'unbound name or reload: ' + fullname)
        if '.' in fullname:
            parent = self.bindings.get(fullname.rpartition('.')[0])
            _guard_require(parent is not None and parent[2]
                           and tuple(path or ()) == (str(parent[0].parent),),
                           'alternate package route: ' + fullname)
        return self._spec(fullname, importlib.machinery.PathFinder.find_spec(fullname, path),
                          self.bindings[fullname])

    def load_bound_alias(self, name):
        """Only the two controller-owned aliases explicitly registered at install."""
        _guard_require(name in self.aliases and name not in sys.modules, 'unbound/replayed alias')
        binding = self.aliases[name]
        ordinary = importlib.util.spec_from_file_location(name, binding[0])
        spec = self._spec(name, ordinary, binding)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        try:
            spec.loader.exec_module(module)
        except BaseException:
            sys.modules.pop(name, None)
            raise
        return module

    def verify_loaded(self):
        """Call at the immediate pre-native-I/O checkpoint, after lazy imports."""
        _guard_require(not self._failed and sys.meta_path and sys.meta_path[0] is self,
                       'guard was removed or a protected import failed')
        ledger = {record[0]: record for record in self._ledger}
        _guard_require(self._started == set(ledger), 'protected import did not finish')
        exports = {name for name,_,_ in self._native_exports}
        _guard_require({name for name in sys.modules if self.protected(name)} == set(ledger)|exports,
                       'protected modules added, removed, or bypassed the guard')
        for name,export,owner in self._native_exports:
            _guard_require(sys.modules.get(name) is export and owner.lib is export
                           and sys.modules.get('curl_cffi._wrapper') is owner,
                           'pinned native export identity changed')
        for name, module, spec, loader, origin, package_paths in self._ledger:
            _guard_require(sys.modules.get(name) is module and module.__spec__ is spec
                           and spec.loader is loader and module.__loader__ is loader
                           and spec.origin == origin and module.__file__ == origin
                           and tuple(spec.submodule_search_locations or ()) == package_paths
                           and tuple(getattr(module, '__path__', ())) == package_paths,
                           'loaded identity changed: ' + name)
            binding = self.aliases.get(name) or self.bindings[name]
            _guard_read(binding[0], binding[1])


def install_source_guard(repo, bundle):
    """Install BEFORE any app/provider imports; no package code is imported here."""
    repo, bundle = Path(repo).absolute(), Path(bundle).absolute()
    admission = json.loads(_guard_read(bundle / 'admission.json'), object_pairs_hook=_guard_pairs)
    runtime = json.loads(_guard_read(bundle / 'runtime-lock.json', admission['runtime_lock_sha256']),
                         object_pairs_hook=_guard_pairs)
    _guard_require(runtime['schema_version'] == 'financial-statement-capture-runtime-lock-v1',
                   'unreviewed runtime schema')
    transport_relative = str((bundle / 'transport-lock.json').relative_to(repo))
    transport = json.loads(_guard_read(bundle / 'transport-lock.json', runtime['files'][transport_relative]),
                           object_pairs_hook=_guard_pairs)
    _guard_require(transport['schema_version'] == 'statement-capture-transport-lock-v1',
                   'unreviewed transport schema')
    bindings = {}

    def add(relative, path, digest, prefix=''):
        if relative.endswith('.py'):
            parts = PurePosixPath(relative).with_suffix('').parts
            package = parts[-1] == '__init__'
            name = '.'.join(parts[:-1] if package else parts)
        elif any(relative.endswith(s) for s in importlib.machinery.EXTENSION_SUFFIXES):
            path_parts = PurePosixPath(relative).parts
            name = '.'.join((*path_parts[:-1], path_parts[-1].split('.')[0]))
            package = False
        else:
            return  # CA data remains covered by the transport runtime verification.
        name = prefix + name
        _guard_require(name not in bindings, 'duplicate import binding: ' + name)
        bindings[name] = (path, digest, package)

    for relative, digest in runtime['files'].items():
        path = _guard_member(repo, relative)
        if relative.startswith('backend/app/'):
            add(relative.removeprefix('backend/'), path, digest)
    required = {'curl_cffi': '0.16.3', 'yfinance': '0.2.66', 'certifi': '2026.7.22', 'cffi': '2.1.1'}
    _guard_require(set(transport['packages']) == set(required), 'incomplete protected packages')
    distributions = {}
    for name, version in required.items():
        package = transport['packages'][name]
        distribution = importlib.metadata.distribution(name)
        _guard_require(distribution.version == package['version'] == version, 'unreviewed package version')
        root = Path(distribution.locate_file('')).absolute()
        distributions[name] = root
        for relative, digest in package['files'].items():
            _guard_require(relative.startswith(name + '/'), 'package inventory escapes root')
            add(relative, _guard_member(root, relative), digest)
    native = transport['cffi_backend']
    _guard_require(PurePosixPath(native['filename']).name == native['filename'], 'unsafe native member')
    add(native['filename'], _guard_member(distributions['cffi'], native['filename']), native['sha256'])
    aliases = {}
    for name, relative in (
            ('app.services._statement_capture_owned_collector', 'backend/app/services/financial_statement_batch.py'),
            ('statement_capture_transport', '.github/scripts/statement-capture-transport.py')):
        aliases[name] = (_guard_member(repo, relative), runtime['files'][relative], False)
    guard = CaptureSourceGuard(bindings, aliases)
    sys.meta_path.insert(0, guard)
    return guard


_SOURCE_GUARD = install_source_guard(ROOT,BUNDLE) if __name__ == '__main__' else None

from app.services import financial_statement_batch as batch
from app.services import statement_artifact_archive as archive
from app.services.statement_retention_budget import StatementRetentionBudget

REQUEST_SHA256 = 'c6f32b4ad7c86dddfbab1e47fcf22b340799a656d531bb71168aab27594eb190'
REQUEST_BYTES = 42472
VERSIONS = {'yfinance':'0.2.66','curl_cffi':'0.16.3','pandas':'2.2.0','numpy':'1.26.3','requests':'2.31.0'}
ADMISSION_FIXED = {'schema_version':'financial-statement-capture-admission-v1',
    'request_id':'first-cnh-esta-annual-history','repository':'kusennjp1-ai/screener','repository_id':1203919607,
    'workflow':'.github/workflows/financial-statement-capture.yml','workflow_id':None,
    'branch':'improve/financial-statement-capture','event':'push','expected_run_number':1,'first_attempt_only':True,
    'request_sha256':REQUEST_SHA256,'maximum_job_seconds':1500,'finalization_reserve_seconds':420,
    'maximum_preflight_age_seconds':30}
ADMISSION_VARIABLE = {'execution_enabled','runtime_lock_sha256','code_tree_sha256','dispatch_not_before',
    'dispatch_not_after','required_valid_through'}
REQUIRED_RUNTIME = {'.github/scripts/run-statement-capture.py','.github/scripts/restore-statement-capture-source.mjs',
    '.github/scripts/verify-statement-capture-artifact.py','.github/workflows/financial-statement-capture.yml',
    '.github/financial-statement-capture/request.json','.github/scripts/verify-successor-artifact.py',
    '.github/scripts/restore-successor-statement-source.mjs','.github/scripts/restore-statement-source.mjs',
    'backend/app/services/financial_statement_batch.py','backend/app/services/statement_artifact_archive.py',
    'backend/app/services/statement_retention_budget.py','.github/scripts/statement-capture-transport.py',
    '.github/financial-statement-capture/transport-lock.json'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(content):
    return hashlib.sha256(content).hexdigest()


def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()


def utc_now():
    return datetime.now(timezone.utc)


def read(path, maximum=2*1024*1024):
    return batch.read_json(archive._safe(path), maximum)


def validate_request(value, content):
    require(len(content) == REQUEST_BYTES and sha(content) == REQUEST_SHA256, 'Exact compact capture request changed')
    require(value['private_report']['sha256'] == 'a5406f2ca7dc0bc05f798d09620ed88e9d999e722177b92fae934c3f9f04b660'
            and value['private_report']['bytes'] == 3140031, 'Private proposal identity changed')
    plan = value['proposal']
    require(sha(canonical(plan)) == value['private_report']['proposal_sha256'], 'Original proposal changed')
    require(len(plan['selected']) == len(plan['batch_allowlist']) == len(set(plan['batch_allowlist'])) == 200,
            'Exact 200-symbol selection required')
    require(plan['batch_allowlist'] == [x['symbol'] for x in plan['selected']]
            and all(x['attributes'] == list(batch.ATTRIBUTES) and x['targets'] == ['annual_history'] for x in plan['selected']),
            'Only ordered annual-history 400-getter envelope is authorized')
    require(not set(plan['batch_allowlist']) & {'BITU','ETHE','SBIT','RH'}, 'Excluded or identity-held symbol selected')
    require(value['retry_decisions'] == value['source_rechecks'] == {} and value['provider_resume'] is None,
            'Capture cannot add retry/recheck/resume decisions')
    require(len(value['held_selected_requirements']) == 21
            and sha(canonical(value['held_selected_requirements'])) == value['held_selected_requirements_sha256'],
            'Original held-target authority ledger changed')


def validate_admission(value, *, now, dry_run, environment):
    require(isinstance(value,dict) and set(value) == set(ADMISSION_FIXED) | ADMISSION_VARIABLE, 'Closed capture admission required')
    require(all(type(value[k]) is type(v) and value[k] == v for k,v in ADMISSION_FIXED.items()), 'Capture admission identity changed')
    require(type(value['execution_enabled']) is bool, 'Boolean capture admission required')
    for key in ('runtime_lock_sha256','code_tree_sha256'):
        require(isinstance(value[key],str) and re.fullmatch('[a-f0-9]{64}',value[key]), 'Missing exact code/lock binding')
    if dry_run:
        require(value['execution_enabled'] is False, 'Offline review must use disabled admission')
        require(all(value[k] is None for k in ('dispatch_not_before','dispatch_not_after','required_valid_through')),
                'Offline review must not select an activation window')
        return
    require(value['execution_enabled'] is True, 'Capture execution is disabled')
    before, after, horizon = (batch.clock(value[k]) for k in ('dispatch_not_before','dispatch_not_after','required_valid_through'))
    require(before <= now <= after and before < after, 'Capture window expired or has not opened')
    require(after-before <= timedelta(hours=1), 'Capture window exceeds one hour')
    require(after+timedelta(seconds=1500) <= horizon <= before+timedelta(hours=72), 'Capture horizon does not cover bounded job or exceeds source policy')
    fixed = {'GITHUB_REPOSITORY':value['repository'],'GITHUB_REPOSITORY_ID':str(value['repository_id']),
        'GITHUB_REF_NAME':value['branch'],'GITHUB_EVENT_NAME':'push','GITHUB_RUN_ATTEMPT':'1','GITHUB_RUN_NUMBER':'1',
        'GITHUB_WORKFLOW_REF':value['repository']+'/'+value['workflow']+'@refs/heads/'+value['branch'],
        'GITHUB_JOB':'statement-capture'}
    require(all(environment.get(k) == v for k,v in fixed.items()), 'Wrong capture caller context')
    require(re.fullmatch('[a-f0-9]{40}',environment.get('GITHUB_SHA','')) is not None
            and re.fullmatch('[1-9][0-9]*',environment.get('GITHUB_RUN_ID','')) is not None, 'Missing actual capture revision/run')


def verify_runtime(repo, lock, admission, *, check_versions=True):
    require(set(lock) == {'schema_version','python','versions','files'}
            and lock['schema_version'] == 'financial-statement-capture-runtime-lock-v1'
            and lock['python'] == '3.11' and lock['versions'] == VERSIONS, 'Unreviewed capture runtime lock')
    require(isinstance(lock['files'],dict) and REQUIRED_RUNTIME <= set(lock['files']), 'Capture owner missing from runtime closure')
    require('.github/financial-statement-capture/admission.json' not in lock['files']
            and '.github/financial-statement-capture/runtime-lock.json' not in lock['files'], 'Circular runtime inventory')
    if check_versions:
        require(sys.version_info[:2] == (3,11), 'Reviewed hosted capture requires Python 3.11')
        require(all(importlib.metadata.version(k) == v for k,v in VERSIONS.items()), 'Unreviewed anonymous transport versions')
    for name, digest in lock['files'].items():
        p = PurePosixPath(name)
        require(not p.is_absolute() and '..' not in p.parts and '\\' not in name, 'Unsafe runtime member')
        require(re.fullmatch('[a-f0-9]{64}',digest) is not None and sha(archive._safe(repo/name).read_bytes()) == digest,
                'Runtime source changed: '+name)


def load_bundle(bundle=BUNDLE, *, dry_run=False, environment=None):
    request, req_bytes = read(bundle/'request.json')
    validate_request(request,req_bytes)
    admission, adm_bytes = read(bundle/'admission.json')
    validate_admission(admission,now=utc_now(),dry_run=dry_run,environment=environment or os.environ)
    lock, lock_bytes = read(bundle/'runtime-lock.json')
    require(sha(lock_bytes) == admission['runtime_lock_sha256'], 'Runtime lock bytes changed')
    verify_runtime(ROOT,lock,admission,check_versions=not dry_run)
    transport_bytes = archive._safe(bundle/'transport-lock.json').read_bytes()
    return request,admission,lock,{'capture-request.json':req_bytes,'capture-admission.json':adm_bytes,
        'capture-runtime-lock.json':lock_bytes,'capture-transport-lock.json':transport_bytes}


def ensure_bundle_unchanged(contents, bundle=BUNDLE):
    for output,name in [('capture-request.json','request.json'),('capture-admission.json','admission.json'),
                        ('capture-runtime-lock.json','runtime-lock.json')]:
        require(archive._safe(bundle/name).read_bytes() == contents[output], 'Capture control bytes changed after validation')
    if 'capture-transport-lock.json' in contents:
        require(archive._safe(bundle/'transport-lock.json').read_bytes() == contents['capture-transport-lock.json'],
                'Capture transport lock changed after validation')


def verify_transport_runtime(content):
    """Bind the native proof to installed source, ABI, CA and extension bytes."""
    value = json.loads(content,object_pairs_hook=batch._pairs)
    require(value['schema_version'] == 'statement-capture-transport-lock-v1'
            and value['platform'] == 'linux-x86_64' and sys.platform == 'linux'
            and platform.machine() == 'x86_64' and value['python'] == '3.11'
            and sys.version_info[:2] == (3,11), 'Unreviewed transport platform or ABI')
    required = {'curl_cffi':'0.16.3','yfinance':'0.2.66','certifi':'2026.7.22','cffi':'2.1.1'}
    require(set(value['packages']) == set(required), 'Incomplete transport package closure')
    for name,version in required.items():
        package = value['packages'][name]
        distribution = importlib.metadata.distribution(name)
        require(package['version'] == distribution.version == version, 'Unreviewed transport dependency')
        installed = {str(p) for p in distribution.files if p.parts[0] == name and str(p).endswith(('.py','.so','.pem'))}
        require(installed == set(package['files']), 'Transport package inventory changed')
        package_root = archive._safe(distribution.locate_file(name))
        physical = {str(p.relative_to(package_root.parent)) for p in package_root.rglob('*')
                    if p.name.endswith(('.py','.so','.pem'))}
        require(physical == installed, 'Unlisted transport package source or native file')
        for relative,digest in package['files'].items():
            require(sha(archive._safe(distribution.locate_file(relative)).read_bytes()) == digest,
                    'Transport package bytes changed: '+relative)
    spec = importlib.util.find_spec('_cffi_backend')
    require(spec is not None and spec.origin is not None, 'Missing native CFFI bridge')
    backend = archive._safe(Path(spec.origin))
    require(backend.name == value['cffi_backend']['filename']
            and sha(backend.read_bytes()) == value['cffi_backend']['sha256'], 'Native CFFI bridge changed')
    require(value['maximum_native_admissions'] == 1000 and value['maximum_admissions_per_perform'] == 1
            and value['redirect_policy'] == 'reject_all_3xx'
            and value['counting'] == 'conservative_native_request_admissions_before_http_do', 'Transport authority changed')


@contextmanager
def owned_collector(policy):
    """Use unchanged collector bytes with a private, explicit runtime seam.

    The standalone capture process must have no prior Yahoo singleton/cache.
    Its documented cache location is a new ephemeral directory outside uploads.
    No shared collector globals or financial validators are patched or copied.
    """
    name = 'app.services._statement_capture_owned_collector'
    require(name not in sys.modules, 'Owned collector was already constructed')
    if _SOURCE_GUARD is not None:
        module = _SOURCE_GUARD.load_bound_alias(name)
        spec = None
    else:
        # Imported synthetic fixtures have no execution authority. run() requires
        # the CLI-installed guard before reaching any provider construction.
        spec = importlib.util.spec_from_file_location(name,Path(batch.__file__))
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
    cache_state = []
    logger = logging.getLogger('yfinance')
    logger_state = (logger.disabled,logger.level,logger.propagate)
    try:
        if spec is not None: spec.loader.exec_module(module)
        original_runtime = module.runtime
        with tempfile.TemporaryDirectory(prefix='statement-capture-anonymous-') as cache_dir:
            def runtime():
                require(not cache_state, 'Owned provider runtime cannot be replayed')
                components = original_runtime()
                from yfinance import cache as yf_cache
                from yfinance.data import YfData
                require(YfData not in type(YfData)._instances, 'Preexisting Yahoo singleton is forbidden')
                managers = (yf_cache._TzDBManager,yf_cache._CookieDBManager,yf_cache._ISINDBManager)
                require(all(manager._db is None for manager in managers)
                        and yf_cache._TzCacheManager._tz_cache is None
                        and yf_cache._CookieCacheManager._Cookie_cache is None
                        and yf_cache._ISINCacheManager._isin_cache is None, 'Preexisting Yahoo cache is forbidden')
                yf_cache.set_cache_location(cache_dir)
                cache_state.extend(managers)
                # Pinned Yahoo debug messages contain transient crumbs/params.
                logger.disabled = True
                logger.propagate = False
                requests = SimpleNamespace(Session=policy.session_class(components[1]))
                return (components[0],requests,*components[2:])
            module.runtime = runtime
            try:
                yield module
            finally:
                for manager in cache_state:
                    manager.close_db()
    finally:
        logger.disabled,logger.level,logger.propagate = logger_state
        sys.modules.pop(name,None)


def verify_executed_runtime():
    require(_SOURCE_GUARD is not None, 'Provider execution requires source-only CLI bootstrap')
    _SOURCE_GUARD.verify_loaded()


def load_transport_policy(**kwargs):
    if _SOURCE_GUARD is not None:
        return _SOURCE_GUARD.load_bound_alias('statement_capture_transport').TransportPolicy(**kwargs)
    spec = importlib.util.spec_from_file_location('statement_capture_transport',ROOT/'.github/scripts/statement-capture-transport.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.TransportPolicy(**kwargs)


def verify_native_journal(path, owned, expected=None):
    """Check the retained original descriptors, complete prefix and pathname."""
    path = archive._safe(path)
    identity = lambda info:(info.st_dev,info.st_ino)
    content = owned['bytes'] if expected is None else expected
    require(str(path) == owned['path'] and not owned['closed'], 'Native journal ownership changed')
    info = os.fstat(owned['fd'])
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and identity(info) == owned['identity']
            and identity(os.fstat(owned['directory_fd'])) == owned['parent_identity']
            and identity(path.parent.lstat()) == owned['parent_identity']
            and identity(os.stat(path.name,dir_fd=owned['directory_fd'],follow_symlinks=False)) == owned['identity']
            and info.st_size == len(content)
            and os.pread(owned['fd'],len(content)+1,0) == content
            and identity(path.lstat()) == owned['identity']
            and identity(path.parent.lstat()) == owned['parent_identity'],
            'Native admission journal changed before issuance')


def close_native_journal(owned):
    if owned is None or owned['closed']:
        return
    identity = lambda info:(info.st_dev,info.st_ino)
    require(identity(os.fstat(owned['fd'])) == owned['identity']
            and identity(os.fstat(owned['directory_fd'])) == owned['parent_identity'],
            'Native journal descriptor ownership changed')
    os.close(owned['fd'])
    os.close(owned['directory_fd'])
    owned['closed'] = True


def persist_native_journal(path, content, previous=None):
    """Durably append through one owned FD. Never rename, truncate or unlink.

    The full expected byte prefix is supplied to keep checks simple and bounded.
    A partial tail on failure is retained as evidence and no later HTTP is allowed.
    A substituted pathname is never reopened as owned or overwritten.
    """
    require(type(content) is bytes and len(content) <= 1024*1024, 'Native journal is unbounded')
    path = archive._safe(path)
    owned = previous
    created = owned is None
    if created:
        parent_info = path.parent.lstat()
        require(stat.S_ISDIR(parent_info.st_mode), 'Native journal parent must be a directory')
        directory = os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:
            actual_parent = os.fstat(directory)
            current_parent = path.parent.lstat()
            require((actual_parent.st_dev,actual_parent.st_ino) == (parent_info.st_dev,parent_info.st_ino)
                    and (current_parent.st_dev,current_parent.st_ino) == (parent_info.st_dev,parent_info.st_ino),
                    'Native journal parent changed before creation')
            descriptor = os.open(path.name,os.O_RDWR|os.O_APPEND|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,
                                 0o600,dir_fd=directory)
        except BaseException:
            os.close(directory)
            raise
        info = os.fstat(descriptor)
        owned = {'fd':descriptor,'directory_fd':directory,'identity':(info.st_dev,info.st_ino),
                 'parent_identity':(parent_info.st_dev,parent_info.st_ino),'path':str(path),'bytes':b'','closed':False}
    try:
        verify_native_journal(path,owned)
        require(content.startswith(owned['bytes']) and len(content) > len(owned['bytes']),
                'Native journal is not append-only')
        offset = len(owned['bytes'])
        while offset < len(content):
            written = os.write(owned['fd'],content[offset:])
            require(written > 0, 'Native journal short write')
            offset += written
        os.fsync(owned['fd'])
        os.fsync(owned['directory_fd'])
        verify_native_journal(path,owned,content)
        owned['bytes'] = content
        return owned
    except BaseException:
        # Reservations are evidence, never a claim that HTTP was sent. Retain
        # complete/partial bytes and every unexpected replacement on failure.
        if created:
            close_native_journal(owned)
        raise


def reserve_native_journal(report):
    """Additional worst-case space beyond the unchanged inherited guard."""
    reservation = {'maximum_events':2001,'maximum_journal_bytes':1024*1024,
        'maximum_summary_bytes':16*1024,'expanded_bytes':4*1024*1024,
        'compressed_bytes':3*1024*1024,'members':8}
    require(report['expanded_headroom_bytes'] >= reservation['expanded_bytes']
            and report['compressed_headroom_bytes'] >= reservation['compressed_bytes']
            and report['member_headroom'] >= reservation['members'], 'Native admission ledger reservation exhausted')
    return {**report,'native_journal_reservation':reservation,
        'expanded_headroom_after_native_reserve':report['expanded_headroom_bytes']-reservation['expanded_bytes'],
        'compressed_headroom_after_native_reserve':report['compressed_headroom_bytes']-reservation['compressed_bytes'],
        'member_headroom_after_native_reserve':report['member_headroom']-reservation['members']}


def whole_job_remaining(started_at, *, now):
    require(isinstance(started_at,str) and started_at, 'Actual bounded job-start clock required')
    elapsed = (now-batch.clock(started_at)).total_seconds()
    require(0 <= elapsed < 1500, 'Actual whole-job clock expired or is in the future')
    return 1500-elapsed


def acquisition_allowance(started_at, *, now):
    allowance = min(1080,whole_job_remaining(started_at,now=now)-420)
    require(allowance > 0, 'Finalization reserve cannot be used for acquisition')
    return allowance


def provider_barrier(loaded):
    for event in loaded.manifest['attempts'].values():
        require(event['outcome'] not in ('provider_blocked','in_flight') and event.get('http_status') not in (403,429),
                'Full retained attempt ledger contains unresolved provider/in-flight barrier')


def validate_restored(restored, request, *, now, offline=False):
    s = request['source']; files = restored/'files'
    if offline:
        provenance_bytes = canonical({'schema_version':'offline-capture-source-fixture-v1','genuine_hosted_caller':False,
            'source':s,'capture_authority':'none'})
    else:
        provenance, provenance_bytes = read(restored/'restored.json')
        require(provenance.get('schema_version') == 'financial-statement-capture-source-restore-v1'
                and provenance.get('kind') == 'authenticated_unadmitted_successor', 'Wrong capture restore provenance')
        for key in ('repository','run_id','run_attempt','head_sha','artifact_id','artifact_sha256'):
            require(provenance.get(key) == s[key], 'Restored source identity changed: '+key)
    base = archive._safe(files/'base.json').read_bytes()
    cohort, cohort_bytes = read(files/'cohort.json')
    require(sha(base) == s['acquisition_base_sha256'] and sha(cohort_bytes) == s['cohort_sha256'], 'Exact base/cohort changed')
    require(len(cohort['symbols']) == len(set(cohort['symbols'])) == 1894, 'Exact original cohort required')
    cycle,_ = read(files/'cycle.json')
    require(cycle.get('schema_version') == 'financial-recovery-cycle-v1' and cycle.get('phase') == 'completed'
            and cycle.get('exit_code') == 0 and cycle.get('archive_manifest_sha256') == s['archive_manifest_sha256']
            and cycle.get('code_revision') == s['head_sha'] and cycle.get('base_artifact_sha256') == s['acquisition_base_sha256']
            and cycle.get('published') is False, 'Successful predecessor cycle identity changed')
    lock = archive._safe(files/'archive/.archive.lock')
    require(lock.is_file() and lock.read_bytes() == b'' and lock.stat().st_nlink == 1, 'Exact empty hidden archive lock required')
    loaded = archive.load_archive(files/'archive',s['archive_manifest_sha256'],base_bytes=base,cohort=cohort,now=now)
    require(len(loaded.manifest['receipts']) == s['retained_receipts'], 'Original receipt count changed')
    provider_barrier(loaded)
    return base,cohort,cohort_bytes,loaded,provenance_bytes


def revalidate_selected(request, loaded, *, base, cohort, now, horizon):
    provider_barrier(loaded)
    planned,_,_ = archive.plan_archive(loaded,base_bytes=base,cohort=cohort,now=now,batch_limit=200,refresh_through=horizon)
    require(planned.provider_state == 'available' and not planned.invalid_receipts, 'Provider or invalid-receipt hold stops capture')
    required = {item.symbol:item for item in planned.required_work}
    for selected in request['proposal']['selected']:
        item = required.get(selected['symbol'])
        annual = [r for r in item.requirements if r.target == 'annual_history'] if item else []
        require(len(annual) == 1 and annual[0].state == 'ready' and list(annual[0].attributes) == list(batch.ATTRIBUTES),
                'Approved annual-history requirement is not ready: '+selected['symbol'])
    # Other targets becoming ready (or newly captured quarterly receipts) do not
    # alter the requested annual-only authority or its original hold decisions.
    return planned


def execution_plan(request, admission, loaded, *, base, cohort, now, job_started_at, offline=False):
    original = request['proposal']
    horizon = now if offline else batch.clock(admission['required_valid_through'])
    require(now >= batch.clock(original['evaluation_time']), 'Execution cannot precede immutable proposal clock')
    require(timedelta(0) <= horizon-now <= timedelta(hours=72), 'Annual source TTL cannot be extended')
    if not offline:
        require(horizon >= batch.clock(job_started_at)+timedelta(seconds=1500), 'Execution horizon cannot cover whole job')
    plan = deepcopy(original)
    plan.update(evaluation_time=batch.timestamp(now),required_valid_through=batch.timestamp(horizon))
    require({k:v for k,v in original.items() if k not in ('evaluation_time','required_valid_through')}
            == {k:v for k,v in plan.items() if k not in ('evaluation_time','required_valid_through')}, 'Forbidden plan transformation')
    require(plan['verified_us_cohort']['symbols'] == sorted(cohort['symbols']), 'Plan cohort membership changed')
    batch.validate_plan(plan,base)
    revalidate_selected(request,loaded,base=base,cohort=cohort,now=now,horizon=horizon)
    transformed = {'schema_version':'financial-statement-capture-plan-transform-v1','request_sha256':REQUEST_SHA256,
        'private_report_sha256':request['private_report']['sha256'],'original_proposal_sha256':sha(canonical(original)),
        'execution_plan_sha256':sha(batch._json_bytes(plan)),'policy':request['transform_policy'],
        'original_clocks':{k:original[k] for k in ('evaluation_time','required_valid_through')},
        'execution_clocks':{k:plan[k] for k in ('evaluation_time','required_valid_through')},
        'offline_only':offline,'source_observations_changed':False,'ttl_changed':False,'selection_changed':False}
    return plan,transformed


def live_preflight(contents, *, environment):
    result = subprocess.run(['node',str(ROOT/'.github/scripts/restore-statement-capture-source.mjs'),'--check-only'],
        check=True,capture_output=True,text=True,timeout=90)
    value = json.loads(result.stdout,object_pairs_hook=batch._pairs)
    require(value.get('schema_version') == 'financial-statement-capture-source-check-v1', 'Wrong live capture metadata proof')
    for field,name in [('request_sha256','capture-request.json'),('admission_sha256','capture-admission.json'),
                       ('runtime_lock_sha256','capture-runtime-lock.json')]:
        require(value.get(field) == sha(contents[name]), 'Live preflight binds different controls')
    require(str(value.get('current',{}).get('id')) == environment['GITHUB_RUN_ID']
            and value.get('current',{}).get('head_sha') == environment['GITHUB_SHA'], 'Live preflight binds another caller')
    require(0 <= (utc_now()-batch.clock(value.get('checked_at'))).total_seconds() <= 30, 'Live preflight is stale')
    return value


def write_inventory(guard, path, *, contents, environment, job_started_at, verified, offline=False, budget_started_at=None, job_deadline=None):
    def check_deadline():
        whole_job_remaining(budget_started_at or job_started_at,now=utc_now())
        require(job_deadline is None or time.monotonic() < job_deadline, 'Monotonic whole-job deadline exhausted')
    measured = guard.snapshot(force_bytes=True)
    # The complete forced measurement itself is charged to the whole-job clock.
    if not offline:
        try: check_deadline()
        except ValueError: verified = False
    expected = {'schema_version':'financial-successor-retained-inventory-v1','final_retention_verified':bool(verified),
        'files':{name:{'bytes':item.size,'sha256':item.sha256} for name,item in measured['files'].items()}}
    value = {'schema_version':'financial-statement-capture-retained-inventory-v1',
        'request_sha256':sha(contents['capture-request.json']),'admission_sha256':sha(contents['capture-admission.json']),
        'runtime_lock_sha256':sha(contents['capture-runtime-lock.json']),
        'run_id':int(environment['GITHUB_RUN_ID']) if not offline else None,'run_attempt':1 if not offline else None,
        'head_sha':environment['GITHUB_SHA'] if not offline else None,'job_started_at':job_started_at,
        'retained_inventory':expected}
    path.parent.mkdir(parents=True,exist_ok=True)
    archive._write_immutable(path,batch._json_bytes(value))
    if not offline:
        try:
            check_deadline()
        except ValueError:
            # The external inventory is not inside the source upload. Replace
            # a just-written success marker with failure if persistence crossed
            # the authenticated job deadline; never retain false success.
            value['retained_inventory']['final_retention_verified'] = False
            replacement = path.with_name(path.name+'.failed')
            try:
                archive._write_immutable(replacement,batch._json_bytes(value))
                os.replace(replacement,path)
            except Exception:
                path.unlink(missing_ok=True)
                raise
            raise
    return value


def run(restored, output, inventory_path, *, dry_run=False, job_started_at=None):
    environment = dict(os.environ)
    request,admission,lock,contents = load_bundle(dry_run=dry_run,environment=environment)
    now = utc_now()
    effective_start = [job_started_at]
    job_deadline = None
    if not dry_run:
        acquisition_allowance(job_started_at,now=now)
        initial_preflight = live_preflight(contents,environment=environment)
        effective_start[0] = initial_preflight['current_job']['started_at']
        require(0 <= (batch.clock(job_started_at)-batch.clock(effective_start[0])).total_seconds() <= 60,
                'Declared job clock differs from authenticated current job')
        acquisition_allowance(effective_start[0],now=utc_now())
        job_deadline = time.monotonic()+whole_job_remaining(effective_start[0],now=utc_now())
    def check_job():
        remaining = whole_job_remaining(effective_start[0],now=utc_now())
        require(job_deadline is not None and time.monotonic() < job_deadline, 'Monotonic whole-job deadline exhausted')
        return min(remaining,job_deadline-time.monotonic())
    base,cohort,cohort_bytes,original,provenance_bytes = validate_restored(restored,request,now=now,offline=dry_run)
    plan,transform = execution_plan(request,admission,original,base=base,cohort=cohort,now=utc_now(),
        job_started_at=job_started_at,offline=dry_run)
    require(not output.exists(), 'Capture output must be new')
    require(output.resolve() != inventory_path.resolve() and output.resolve() not in inventory_path.resolve().parents,
            'Readback inventory must be outside uploaded source')
    output.mkdir(parents=True)
    for name,data in {**contents,'base.json':base,'cohort.json':cohort_bytes,'source-provenance.json':provenance_bytes,
                      'plan.json':batch._json_bytes(plan),'capture-plan-transform.json':batch._json_bytes(transform)}.items():
        archive._write_immutable(output/name,data)
    authority = {'schema_version':'financial-statement-capture-authority-v1','request_sha256':REQUEST_SHA256,
        'targets':['annual_history'],'held_selected_requirements':request['held_selected_requirements'],
        'held_selected_requirements_sha256':request['held_selected_requirements_sha256'],
        'held_targets_cleared':False,'retry_decisions':{},'source_rechecks':{},'provider_resume':None,
        'financial_admission':'not_granted','publication_authority':'none'}
    archive._write_immutable(output/'capture-authority.json',batch._json_bytes(authority))
    shutil.copytree(original.root,output/'archive')
    cache,cache_sha = archive.export_cache(original,plan,base,output/'selected-cache',now=utc_now())
    batch.write_json(output/'cycle.json',{'schema_version':'financial-statement-capture-cycle-v1','phase':'prepared',
        'dry_run':dry_run,'archive_manifest_sha256':request['source']['archive_manifest_sha256'],
        'base_artifact_sha256':request['source']['acquisition_base_sha256'],'published':False,
        'request_sha256':REQUEST_SHA256,'held_targets_cleared':False,'financial_admission':'not_granted'})
    guard = StatementRetentionBudget(output,selected_symbols=200,max_transport_requests=1000)
    final_verified = False
    result = None
    code = 3
    try:
        capacity = reserve_native_journal(guard.check('initial'))
        ensure_bundle_unchanged(contents)
        if dry_run:
            # Offline review validates exact cache and capacity without importing
            # or constructing a provider runtime, and claims no hosted caller.
            batch.load_cache(cache,cache_sha,plan,now=utc_now())
            return {'mode':'offline_dry_run','genuine_hosted_caller':False,'provider_requests':0,
                'selected_symbols':200,'selected_getter_slots':400,'admission_enabled':False,
                'held_targets_cleared':False,'financial_admission':'not_granted','published':False,
                'capacity':capacity,'execution_plan_sha256':transform['execution_plan_sha256']},0
        verify_runtime(ROOT,lock,admission)
        allowance = min(acquisition_allowance(effective_start[0],now=utc_now()),check_job()-420)
        require(allowance > 0, 'Finalization reserve cannot be used for acquisition')
        acquisition_end = time.monotonic()+allowance
        verify_executed_runtime()
        verify_transport_runtime(contents['capture-transport-lock.json'])
        native_events = []
        native_journal_bytes = [None]
        native_journal_identity = [None]
        first_native_preflight = [None]
        first_native_response = [False]
        def native_boundary():
            ensure_bundle_unchanged(contents)
            verify_runtime(ROOT,lock,admission)
            verify_transport_runtime(contents['capture-transport-lock.json'])
            verify_executed_runtime()
            require(logging.getLogger('yfinance').disabled, 'Yahoo transient-value logging is forbidden')
            if not first_native_response[0]:
                require(first_native_preflight[0] is not None
                        and 0 <= (utc_now()-batch.clock(first_native_preflight[0])).total_seconds() <= 30,
                        'Live preflight is stale before first native HTTP issuance')
            native_retention()
            if native_journal_bytes[0] is not None:
                verify_native_journal(output/'batch/native-http-admissions.jsonl',native_journal_identity[0])
            require(check_job() > 420 and acquisition_allowance(effective_start[0],now=utc_now()) > 0
                    and time.monotonic() < acquisition_end, 'Native request would use finalization reserve')
        def native_retention():
            reserve_native_journal(guard.check('transport'))
        def record_native(event):
            require(len(native_events) < 2001, 'Native audit event bound exhausted')
            native_events.append(deepcopy(event))
            header = {'schema_version':'statement-capture-native-admission-journal-v1',
                      'counting':'conservative_native_request_admissions_before_http_do',
                      'maximum_native_admissions':1000}
            raw = b'\n'.join(canonical(value) for value in [header,*native_events])+b'\n'
            require(len(raw) <= 1024*1024, 'Native audit byte bound exhausted')
            native_journal_identity[0] = persist_native_journal(output/'batch/native-http-admissions.jsonl',raw,
                                                               native_journal_identity[0])
            native_journal_bytes[0] = raw
            if event.get('kind') == 'native_response_observed':
                first_native_response[0] = True
        policy = load_transport_policy(symbols=plan['batch_allowlist'],deadline_monotonic=acquisition_end,
            boundary_check=native_boundary,retention_check=native_retention,record=record_native)
        def first_provider():
            ensure_bundle_unchanged(contents)
            verify_runtime(ROOT,lock,admission)
            validate_admission(admission,now=utc_now(),dry_run=False,environment=environment)
            # Recheck original bytes and exactly the selected annual target at
            # the actual boundary; never use planner.batch as a replacement.
            checked = archive.load_archive(output/'archive',original.sha256,base_bytes=base,cohort=cohort,now=utc_now())
            revalidate_selected(request,checked,base=base,cohort=cohort,now=utc_now(),horizon=batch.clock(plan['required_valid_through']))
            preflight = live_preflight(contents,environment=environment)
            api_start = preflight['current_job']['started_at']
            require(0 <= (batch.clock(job_started_at)-batch.clock(api_start)).total_seconds() <= 60,
                    'Declared job clock differs from authenticated current job')
            require(api_start == effective_start[0], 'Authenticated job-start clock changed')
            # If API time is earlier, leave that whole-job reserve intact: a
            # collector allowance larger than the remaining API budget rejects.
            remaining = acquisition_allowance(api_start,now=utc_now())
            require(acquisition_end-time.monotonic() <= remaining+0.1, 'Authenticated setup time shrinks acquisition budget')
            archive._write_immutable(inventory_path.parent/'capture-preflight.json',batch._json_bytes(preflight))
            ensure_bundle_unchanged(contents)
            guard.check('getter')
            verify_runtime(ROOT,lock,admission)
            ensure_bundle_unchanged(contents)
            ready = utc_now()
            validate_admission(admission,now=ready,dry_run=False,environment=environment)
            require(0 <= (ready-batch.clock(preflight['checked_at'])).total_seconds() <= 30, 'Preflight stale at first provider')
            acquisition_allowance(api_start,now=ready)
            require(time.monotonic() < acquisition_end, 'Acquisition deadline exhausted at provider boundary')
            first_native_preflight[0] = preflight['checked_at']
        try:
            with owned_collector(policy) as collector:
                result,code = collector.collect(plan,base,output/'batch',cache_manifest=cache,cache_sha256=cache_sha,
                    acquisition_budget_seconds=max(0,acquisition_end-time.monotonic()),
                    max_statement_getter_calls=400,max_transport_requests=1000,
                    retention_guard=guard,before_first_provider=first_provider)
        finally:
            close_native_journal(native_journal_identity[0])
            native_summary = policy.audit_record()
            require(len(batch._json_bytes(native_summary)) <= 16*1024, 'Native summary byte bound exhausted')
            batch.write_json(output/'batch/native-http-summary.json',native_summary)
        require(not policy.fatal or code != 0, 'Native transport stop cannot be reported as capture success')
        check_job()
        ensure_bundle_unchanged(contents)
        guard.before_merge()
        digest = archive.merge_batch(output/'archive',original.sha256,batch_dir=output/'batch',
            summary_sha256=sha((output/'batch/summary.json').read_bytes()),base_bytes=base,cohort=cohort,now=utc_now(),
            maximum_manifest_bytes=guard.maximum_manifest_bytes)
        checked = archive.load_archive(output/'archive',digest,base_bytes=base,cohort=cohort,now=utc_now())
        require(all(checked.manifest['receipts'].get(k) == v for k,v in original.manifest['receipts'].items())
                and all(checked.manifest['attempts'].get(k) == v for k,v in original.manifest['attempts'].items()),
                'Original receipt or attempt ledger changed')
        cycle = {'schema_version':'financial-statement-capture-cycle-v1','phase':'completed','dry_run':False,
            'code_revision':environment['GITHUB_SHA'],'archive_manifest_sha256':digest,'previous_archive_manifest_sha256':original.sha256,
            'base_artifact_sha256':request['source']['acquisition_base_sha256'],'request_sha256':REQUEST_SHA256,
            'execution_plan_sha256':transform['execution_plan_sha256'],'selected_symbols':200,'selected_getter_slots':400,
            'exit_code':code,'source_run_id':request['source']['run_id'],'source_run_attempt':1,
            'held_selected_requirements_sha256':request['held_selected_requirements_sha256'],'held_targets_cleared':False,
            'financial_admission':'not_granted','published':False,'actual_uploaded_readback_required':True,
            'statement_getter_calls':result['statement_getter_calls'],'transport_calls':result['transport_calls'],
            'transport_calls_semantics':'inherited_session_request_invocations',
            'native_http_accounting':native_summary,
            'acquisition_counts':result.get('counts')}
        cycle_sha = batch.write_json(output/'cycle.json',cycle)
        guard.authorize_finalization(archive_manifest_sha256=digest,cycle_sha256=cycle_sha,archive_object_sha256s=checked.manifest['objects'])
        retention = guard.verify_final()
        check_job()
        ensure_bundle_unchanged(contents)
        final_verified = code == 0
        return {**cycle,'retention':retention,'acquisition_counts':result.get('counts')},code
    finally:
        # A failed or partial attempt is never upgraded by byte retention.
        write_inventory(guard,inventory_path,contents=contents,environment=environment,job_started_at=job_started_at,
            verified=final_verified,offline=dry_run,budget_started_at=effective_start[0],job_deadline=job_deadline)
        if not dry_run: check_job()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--restored',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--inventory',type=Path,required=True)
    parser.add_argument('--job-started-at')
    parser.add_argument('--dry-run',action='store_true')
    args = parser.parse_args()
    summary,code = run(args.restored,args.output,args.inventory,dry_run=args.dry_run,job_started_at=args.job_started_at)
    print(json.dumps(summary,sort_keys=True))
    raise SystemExit(code)
