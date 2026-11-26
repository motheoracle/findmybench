import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  message: string;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || 'Something unexpected happened.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[FindMyBench ErrorBoundary]', error, info.componentStack);
  }

  private reset = () => {
    this.setState({ hasError: false, message: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-card" role="alert">
          <h3>{this.props.fallbackTitle || 'Something went wrong'}</h3>
          <p className="muted small">{this.state.message}</p>
          <div className="row-gap mt">
            <button type="button" className="btn btn-primary btn-sm" onClick={this.reset}>
              Try again
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.location.reload()}>
              Reload app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
