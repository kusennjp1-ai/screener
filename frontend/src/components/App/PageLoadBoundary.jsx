import { Component, Suspense } from 'react';
import { Alert, Box, Button } from '@mui/material';
import PageLoadingFallback from './PageLoadingFallback';

const reloadPage = () => window.location.reload();

export default class PageLoadBoundary extends Component {
  state = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.resetKey) {
      return { failed: false, resetKey: props.resetKey };
    }
    return null;
  }

  render() {
    if (this.state.failed) {
      // React.lazy caches rejected imports. Reload resolves a new deployment's
      // hashed chunk URLs and preserves this route, query and browser history.
      return (
        <Box sx={{ p: 3 }}>
          <Alert severity="error" action={<Button color="inherit" onClick={this.props.onReload || reloadPage}>Reload / 再読み込み</Button>}>
            This page could not load. Reload to retry. / ページを読み込めませんでした。再読み込みしてください。
          </Alert>
        </Box>
      );
    }

    return <Suspense fallback={<PageLoadingFallback />}>{this.props.children}</Suspense>;
  }
}
