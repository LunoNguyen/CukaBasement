import { Controller, Get, Param } from '@nestjs/common'
import { CurrentViewer } from '../auth/decorators'
import type { Viewer } from '../auth/viewer'
import { UsersService } from './users.service'

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get(':username')
  get(@CurrentViewer() v: Viewer | null, @Param('username') username: string) {
    return this.users.getPublic(username, v)
  }
}
