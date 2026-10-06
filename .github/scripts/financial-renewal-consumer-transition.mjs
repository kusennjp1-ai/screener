// One finite reviewed close/price-guard transition. This is an identity catalog,
// not authority: production's separately hash-bound renewal registry is empty.
// These exact additions change price admission/pointer handling, never financial
// projection arithmetic. Same-price targets, all emitted UI, native replay and
// complete A/B/C controller inventories retain their independent checks.
import {digest} from './financial-correction.mjs';
import {bootstrap} from './publication-state.mjs';
import {remoteProtectedCodeInventory} from './financial-performance-exception.mjs';

const reviewedMain135={
  "transition_id": "main135-close-price-guards-v1",
  "captured_ui_sha": "1e1943e1d5f78a738a05baa69eb9f2e8508e32ac",
  "reviewed_sha": "1356148aecb8dc03b01fda103d2dd416cce05db6",
  "reviewed_tree": "b39d5283d77c85cba454add980ea3c2c472232be",
  "changes": {
    "backend/app/config/settings.py": {
      "before": {
        "mode": "100644",
        "sha": "38173e5a99f703092c49f6f12f4b94ca71a4a4d1"
      },
      "after": {
        "mode": "100644",
        "sha": "04688043c3541d6f22fa251eb6b07c25b5b02d26"
      }
    },
    "backend/app/scripts/daily_price_artifact_provenance.py": {
      "before": null,
      "after": {
        "mode": "100644",
        "sha": "be713d80a742061840c4decad9aa3e756ecff617"
      }
    },
    "backend/app/scripts/inspect_us_close_session.py": {
      "before": null,
      "after": {
        "mode": "100644",
        "sha": "66b72dd63a5d2a39bf028c75a80db031a1424b75"
      }
    },
    "backend/app/scripts/publish_daily_price_bundle.py": {
      "before": null,
      "after": {
        "mode": "100644",
        "sha": "1d28ac503e539f101b74641d5fac8d8242766d3d"
      }
    },
    "backend/app/scripts/stage_daily_price_source.py": {
      "before": null,
      "after": {
        "mode": "100644",
        "sha": "c8ce1eef20a765f03fa0e9641f55f533c4a5899d"
      }
    },
    "backend/app/services/close_price_contract.py": {
      "before": null,
      "after": {
        "mode": "100644",
        "sha": "b3a942013f357d60d1c68a1ef2a5ab9c438668aa"
      }
    },
    "backend/app/services/daily_price_bundle_service.py": {
      "before": {
        "mode": "100644",
        "sha": "2466e30d0deb5e5154a7934b523d3a701b63241e"
      },
      "after": {
        "mode": "100644",
        "sha": "6e83106ba3be0d2bc280549360d7768e7a54b664"
      }
    },
    "backend/app/services/github_release_sync_service.py": {
      "before": {
        "mode": "100644",
        "sha": "32535b6958370be1bb185edcabce62d48ab7c437"
      },
      "after": {
        "mode": "100644",
        "sha": "5e4e599679752a89d5e646fdf2fa1901be56e2bd"
      }
    },
    "backend/app/services/market_calendar_service.py": {
      "before": {
        "mode": "100644",
        "sha": "c5033f42b4621b37f274b564eb1886aaca7fbc42"
      },
      "after": {
        "mode": "100644",
        "sha": "7563650508872805f978df2c6d40c7a3ff845e02"
      }
    }
  }
};
// A caller receives only a clone for explicit reviewed-registry construction.
// Supplying this value to a candidate, CLI or environment grants no authority.
export const reviewedMain135ConsumerTransition=()=>structuredClone(reviewedMain135);

export function validateReviewedConsumerTransitions(entries){
  if(!Array.isArray(entries)||entries.length>1)throw Error('Invalid bounded reviewed consumer transitions');
  for(const entry of entries)if(digest(entry)!==digest(reviewedMain135))throw Error('Invalid exact reviewed main135 consumer transition');
  return entries;
}

export function verifyReviewedConsumerTransition({entries,request,api}){
  validateReviewedConsumerTransitions(entries);
  if(!entries.length)return null;
  const entry=entries[0];
  if(request.ui.sha!==entry.captured_ui_sha)throw Error('Reviewed main135 transition belongs to another captured UI');
  const captured=remoteProtectedCodeInventory(entry.captured_ui_sha,api);
  const reviewedEndpoint=`repos/${bootstrap.repository}/git/commits/${entry.reviewed_sha}`;
  const reviewed=remoteProtectedCodeInventory(entry.reviewed_sha,(endpoint,...args)=>{
    const value=api(endpoint,...args);
    // Bind the very commit response used to select the inventory tree, rather
    // than checking a separate read and then trusting a second tree selector.
    if(endpoint===reviewedEndpoint&&(value?.sha!==entry.reviewed_sha||value.tree?.sha!==entry.reviewed_tree))throw Error('Reviewed main135 consumer commit/tree changed');
    return value;
  });
  for(const [path,change]of Object.entries(entry.changes)){
    if(digest(captured[path]??null)!==digest(change.before)||digest(reviewed[path]??null)!==digest(change.after))throw Error('Reviewed main135 Git inventory changed an exact before/after pair');
  }
  return {changes:entry.changes,captured,reviewed};
}
