import { Controller, Get, Module, Post } from '@nestjs/common'
import { Auth, CurrentViewer } from '../src/auth/decorators'
import type { Viewer } from '../src/auth/viewer'

/** Routes for exercising AuthGuard; imported by the test harness only, never by AppModule. */
@Controller('__test')
class TestOnlyController {
  @Get('public')
  public(@CurrentViewer() viewer: Viewer | null) {
    return { viewer }
  }

  @Get('auth')
  @Auth()
  auth(@CurrentViewer() viewer: Viewer) {
    return { viewer }
  }

  @Get('verified')
  @Auth({ verified: true })
  verified(@CurrentViewer() viewer: Viewer) {
    return { viewer }
  }

  @Post('write')
  @Auth({ write: true })
  write(@CurrentViewer() viewer: Viewer) {
    return { viewer }
  }

  @Get('admin')
  @Auth({ roles: ['admin'] })
  admin(@CurrentViewer() viewer: Viewer) {
    return { viewer }
  }
}

@Module({ controllers: [TestOnlyController] })
export class TestOnlyModule {}
